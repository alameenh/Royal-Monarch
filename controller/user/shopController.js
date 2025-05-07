import Product from '../../model/productModel.js';
import Category from '../../model/categoryModel.js';
import Offer from '../../model/offerModel.js';
import mongoose from 'mongoose';
import User from '../../model/userModel.js';
import Wallet from '../../model/walletModel.js';
import Address from '../../model/addressModel.js';
import CartItem from '../../model/cartModel.js';
import Coupon from '../../model/couponModel.js';
import Order from '../../model/orderModel.js';
import { v4 as uuidv4 } from 'uuid';
import razorpay, { verifyRazorpayConfig } from '../../utils/razorpay.js';
import crypto from 'crypto';
import { log } from 'console';
import Wishlist from '../../model/wishlistModel.js';

const getShopPage = async (req, res) => {
    try {
        // Get all categories
        const categories = await Category.find({ status: 'Active' });
        
        // Get cart count for navbar
        const userId = req.session.userId;
        const cartCount = await CartItem.countDocuments({ userId });

        // Get category filter from URL if present
        const categoryFilter = req.query.category || '';
        
        res.render('user/shop', { 
            categories,
            cartCount,
            initialCategory: categoryFilter // Pass the category filter to the view
        });
    } catch (error) {
        console.error('Shop Page Error:', error);
        res.status(500).json({ success: false, message: 'Error loading shop page' });
    }
};

const getProducts = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 12;
        const search = req.query.search || '';
        const category = req.query.category || '';
        const sortBy = req.query.sortBy || 'createdAt';
        const order = req.query.order || 'desc';
        
        // Validate and parse price filters
        let minPrice = 0;
        let maxPrice = Number.MAX_SAFE_INTEGER;
        
        if (req.query.minPrice) {
            const parsedMinPrice = parseFloat(req.query.minPrice);
            if (!isNaN(parsedMinPrice) && parsedMinPrice >= 0) {
                minPrice = parsedMinPrice;
            }
        }
        
        if (req.query.maxPrice) {
            const parsedMaxPrice = parseFloat(req.query.maxPrice);
            if (!isNaN(parsedMaxPrice) && parsedMaxPrice >= 0) {
                maxPrice = parsedMaxPrice;
            }
        }
        
        // Ensure maxPrice is greater than minPrice
        if (maxPrice < minPrice) {
            maxPrice = Number.MAX_SAFE_INTEGER;
        }

        // Get current date for offer validation
        const currentDate = new Date();

        // Fetch active offers
        const activeOffers = await Offer.find({
            isActive: true,
            startDate: { $lte: currentDate },
            endDate: { $gte: currentDate }
        });

        // Get user's wishlist and cart if logged in
        let wishlistMap = new Map();
        let cartMap = new Map();
        if (req.session.userId) {
            const [wishlist, cartItems] = await Promise.all([
                Wishlist.findOne({ userId: req.session.userId }),
                CartItem.find({ userId: req.session.userId })
            ]);

            if (wishlist) {
                wishlist.products.forEach(item => {
                    const key = `${item.productId.toString()}-${item.variantType}`;
                    wishlistMap.set(key, true);
                });
            }

            if (cartItems) {
                cartItems.forEach(item => {
                    const key = `${item.productId.toString()}-${item.variantType}`;
                    cartMap.set(key, true);
                });
            }
        }

        // Build base query
        let query = { status: 'Active' };

        // Add search conditions
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { brand: { $regex: search, $options: 'i' } }
            ];
        }

        // Add category filter
        if (category) {
            query.category = new mongoose.Types.ObjectId(category);
        }

        // First get all products without price filtering
        const products = await Product.aggregate([
            {
                $lookup: {
                    from: 'categories',
                    localField: 'category',
                    foreignField: '_id',
                    as: 'categoryData'
                }
            },
            {
                $unwind: '$categoryData'
            },
            {
                $match: {
                    ...query,
                    'categoryData.status': 'Active'
                }
            }
        ]);

        // Process products to include offer information and calculate final prices
        const processedProducts = products.map(product => {
            // Find product-specific offer
            const productOffer = activeOffers.find(offer => 
                offer.type === 'product' && 
                offer.productIds.some(id => id.toString() === product._id.toString())
            );

            // Find category offer
            const categoryOffer = activeOffers.find(offer => 
                offer.type === 'category' && 
                offer.categoryId.toString() === product.category.toString()
            );

            // Use product offer if available, otherwise use category offer
            const applicableOffer = productOffer || categoryOffer;

            // Add wishlist and cart status to each variant
            const variantsWithStatus = product.variants.map(variant => ({
                ...variant,
                inWishlist: wishlistMap.has(`${product._id.toString()}-${variant.type}`),
                inCart: cartMap.has(`${product._id.toString()}-${variant.type}`)
            }));

            // Calculate discounted price for the base variant
            const baseVariant = variantsWithStatus[0];
            const originalPrice = baseVariant.price;
            const discountedPrice = applicableOffer 
                ? Math.round(originalPrice * (1 - applicableOffer.discount/100))
                : originalPrice;

            return {
                ...product,
                variants: variantsWithStatus,
                offer: applicableOffer,
                discountedPrice,
                originalPrice
            };
        });

        // Apply price filtering after calculating discounted prices
        const filteredProducts = processedProducts.filter(product => {
            const price = product.discountedPrice;
            return price >= minPrice && price <= maxPrice;
        });

        // Apply sorting after filtering
        let sortedProducts = [...filteredProducts];
        if (sortBy === 'price') {
            sortedProducts.sort((a, b) => {
                const priceA = a.discountedPrice;
                const priceB = b.discountedPrice;
                if (priceA === priceB) {
                    return a.name.localeCompare(b.name);
                }
                if (order === 'desc') {
                    return priceB - priceA; // High to low
                } else {
                    return priceA - priceB; // Low to high
                }
            });
        } else {
            sortedProducts.sort((a, b) => {
                if (sortBy === 'name') {
                    return order === 'desc' 
                        ? b.name.localeCompare(a.name)
                        : a.name.localeCompare(b.name);
                } else {
                    return order === 'desc' 
                        ? new Date(b[sortBy]) - new Date(a[sortBy])
                        : new Date(a[sortBy]) - new Date(b[sortBy]);
                }
            });
        }

        // Apply pagination
        const totalProducts = sortedProducts.length;
        const totalPages = Math.ceil(totalProducts / limit);
        const paginatedProducts = sortedProducts.slice((page - 1) * limit, page * limit);

        res.json({
            success: true,
            products: paginatedProducts,
            pagination: {
                currentPage: page,
                totalPages,
                totalProducts,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
        });

    } catch (error) {
        console.error('Get Products Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching products'
        });
    }
};

const getProductDetails = async (req, res) => {
    try {
        const productId = req.params.productId;
        const product = await Product.findOne({ 
            _id: productId, 
            status: 'Active' 
        }).populate('category');

        if (!product) {
            return res.status(404).render('error', { 
                message: 'Product not found' 
            });
        }

        // Get similar products from same category
        const similarProducts = await Product.find({
            category: product.category._id,
            _id: { $ne: product._id },
            status: 'Active'
        })
        .limit(4);

        res.render('user/product', { 
            product, 
            similarProducts 
        });

    } catch (error) {
        console.error('Product Details Error:', error);
        res.status(500).render('error', { 
            message: 'Error loading product details' 
        });
    }
};

const getCategories = async (req, res) => {
    try {
        const categories = await Category.find({ 
            status: 'Active' 
        });

        res.json({
            success: true,
            categories
        });

    } catch (error) {
        console.error('Get Categories Error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching categories' 
        });
    }
};

export default { 
    getShopPage, 
    getProducts, 
    getProductDetails, 
    getCategories
};
