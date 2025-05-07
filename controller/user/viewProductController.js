import Product from '../../model/productModel.js';
import Category from '../../model/categoryModel.js';
import User from '../../model/userModel.js';
import Wishlist from '../../model/wishlistModel.js';
import CartItem from '../../model/cartModel.js';
import mongoose from 'mongoose';
import Offer from '../../model/offerModel.js';

const viewProduct = async (req, res) => {
    try {
        const productId = req.params.productId;
        const userId = req.session.userId;

        console.log('Viewing product:', { productId, userId });

        if (!productId) {
            console.log('No product ID provided');
            return res.status(400).render('error', { 
                message: 'Product ID is required' 
            });
        }
        
        // Get the product details with proper population
        const product = await Product.findById(productId)
            .populate({
                path: 'category',
                select: 'name'
            })
            .lean();

        if (!product) {
            console.log('Product not found');
            return res.status(404).render('error', { 
                message: 'Product not found' 
            });
        }

        if (product.status !== 'Active') {
            console.log('Product not active');
            return res.status(404).render('error', { 
                message: 'This product is not available' 
            });
        }

        // Get current date for offer validation
        const currentDate = new Date();

        // Fetch active offers
        const activeOffers = await Offer.find({
            isActive: true,
            startDate: { $lte: currentDate },
            endDate: { $gte: currentDate }
        });

        // Initialize wishlist and cart data
        let wishlistStatus = {};
        let isInWishlist = false;
        let wishlistCount = 0;
        let cartItems = [];
        let cartCount = 0;

        // Get wishlist and cart data if user is logged in
        if (userId) {
            // Get wishlist data
            const wishlist = await Wishlist.findOne({ userId });
            if (wishlist) {
                wishlistCount = wishlist.products.length;
                wishlistStatus = wishlist.products.reduce((acc, item) => {
                    acc[item.productId.toString()] = acc[item.productId.toString()] || {};
                    acc[item.productId.toString()][item.variantType] = true;
                    return acc;
                }, {});
            }

            // Get cart data
            cartItems = await CartItem.find({ userId }).lean();
            cartCount = await CartItem.countDocuments({ userId });
        }

        // Mark which variants are in cart and add offer information for main product
        product.variants = product.variants.map(variant => {
            const inCart = cartItems.some(item => 
                item.productId.toString() === productId && 
                item.variantType === variant.type
            );
            const inWishlist = wishlistStatus[productId]?.[variant.type] || false;
            
            // Find applicable offer for this variant
            const productOffer = activeOffers.find(offer => 
                offer.type === 'product' && 
                offer.productIds.some(id => id.toString() === productId)
            );

            const categoryOffer = activeOffers.find(offer => 
                offer.type === 'category' && 
                offer.categoryId.toString() === product.category._id.toString()
            );

            const applicableOffer = productOffer || categoryOffer;
            const offerName = applicableOffer ? applicableOffer.name : null;
            const offerDiscount = applicableOffer ? applicableOffer.discount : 0;

            return { 
                ...variant,
                inCart,
                inWishlist,
                offerName,
                discount: Math.max(variant.discount || 0, offerDiscount)
            };
        });

        // Check if the first variant is in wishlist
        if (product.variants.length > 0) {
            isInWishlist = product.variants[0].inWishlist;
        }

        // Get similar products from same category
        const similarProducts = await Product.find({
            category: product.category._id,
            _id: { $ne: productId },
            status: 'Active'
        })
        .populate('category', 'name')
        .lean()
        .limit(5);

        // Process similar products to include offer information and cart/wishlist status
        const processedSimilarProducts = similarProducts.map(similarProduct => {
            // Find product-specific offer
            const productOffer = activeOffers.find(offer => 
                offer.type === 'product' && 
                offer.productIds.some(id => id.toString() === similarProduct._id.toString())
            );

            // Find category offer
            const categoryOffer = activeOffers.find(offer => 
                offer.type === 'category' && 
                offer.categoryId.toString() === similarProduct.category._id.toString()
            );

            // Use product offer if available, otherwise use category offer
            const applicableOffer = productOffer || categoryOffer;

            // Process variants with cart status and offers
            similarProduct.variants = similarProduct.variants.map(variant => {
                const inCart = cartItems.some(item => 
                    item.productId.toString() === similarProduct._id.toString() && 
                    item.variantType === variant.type
                );
                const inWishlist = wishlistStatus[similarProduct._id.toString()]?.[variant.type] || false;

                return {
                    ...variant,
                    inCart,
                    inWishlist,
                    offerName: applicableOffer ? applicableOffer.name : null,
                    discount: applicableOffer ? applicableOffer.discount : 0
                };
            });

            return {
                ...similarProduct,
                offer: applicableOffer
            };
        });

        console.log('Rendering viewProduct template');
        res.render('user/viewProduct', {
            product,
            similarProducts: processedSimilarProducts,
            isInWishlist,
            initialCartStatus: product.variants[0].inCart,
            wishlistCount,
            cartCount
        });
    } catch (error) {
        console.error('View Product Error:', error);
        res.status(500).render('error', { 
            message: 'Error loading product details' 
        });
    }
};

const getProductsByCategory = async (req, res) => {
    try {
        const categoryId = req.params.categoryId;
        const page = parseInt(req.query.page) || 1;
        const limit = 12;

        const category = await Category.findById(categoryId);
        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Category not found'
            });
        }

        const products = await Product.find({
            category: categoryId,
            status: 'Active'
        })
        .populate('category')
        .skip((page - 1) * limit)
        .limit(limit);

        const total = await Product.countDocuments({
            category: categoryId,
            status: 'Active'
        });

        res.json({
            success: true,
            products,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(total / limit),
                totalProducts: total
            }
        });

    } catch (error) {
        console.error('Category Products Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching category products'
        });
    }
};

const searchProducts = async (req, res) => {
    try {
        const { query, minPrice, maxPrice, sortBy, order } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = 12;

        const searchQuery = {
            status: 'Active',
            $or: [
                { name: { $regex: query, $options: 'i' } },
                { brand: { $regex: query, $options: 'i' } }
            ]
        };

        if (minPrice || maxPrice) {
            searchQuery['variants.price'] = {};
            if (minPrice) searchQuery['variants.price'].$gte = parseInt(minPrice);
            if (maxPrice) searchQuery['variants.price'].$lte = parseInt(maxPrice);
        }

        const sortOptions = {};
        if (sortBy) {
            sortOptions[sortBy] = order === 'asc' ? 1 : -1;
        }

        const products = await Product.find(searchQuery)
            .populate('category')
            .sort(sortOptions)
            .skip((page - 1) * limit)
            .limit(limit);

        const total = await Product.countDocuments(searchQuery);

        res.json({
            success: true,
            products,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(total / limit),
                totalProducts: total
            }
        });

    } catch (error) {
        console.error('Search Products Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error searching products'
        });
    }
};

// Add a new method to toggle wishlist status
const toggleWishlist = async (req, res) => {
    try {
        const productId = req.params.productId;
        const userId = req.session.userId;
        const { variantType } = req.body;
        const WISHLIST_LIMIT = 10;  // Define the wishlist limit
        
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Please login to add items to wishlist'
            });
        }

        if (!productId) {
            return res.status(400).json({
                success: false,
                message: 'Product ID is required'
            });
        }

        if (!variantType) {
            return res.status(400).json({
                success: false,
                message: 'Variant type is required'
            });
        }
        
        // Find user's wishlist
        let wishlist = await Wishlist.findOne({ userId });
        
        // If no wishlist exists, create one
        if (!wishlist) {
            wishlist = new Wishlist({
                userId,
                products: [{
                    productId: new mongoose.Types.ObjectId(productId),
                    variantType,
                    addedAt: new Date()
                }]
            });
            await wishlist.save();
            return res.json({
                success: true,
                added: true,
                message: 'Product added to wishlist',
                wishlistCount: 1
            });
        }
        
        // Check if product with specific variant is already in wishlist
        const productIndex = wishlist.products.findIndex(
            item => item.productId && item.productId.toString() === productId && item.variantType === variantType
        );
        
        if (productIndex > -1) {
            // Remove from wishlist
            wishlist.products.splice(productIndex, 1);
            await wishlist.save();
            return res.json({
                success: true,
                added: false,
                message: 'Product removed from wishlist',
                wishlistCount: wishlist.products.length
            });
        } else {
            // Check wishlist limit before adding
            if (wishlist.products.length >= WISHLIST_LIMIT) {
                return res.status(400).json({
                    success: false,
                    message: 'Wishlist limit reached (maximum 10 items)'
                });
            }
            
            // Add to wishlist
            wishlist.products.push({
                productId: new mongoose.Types.ObjectId(productId),
                variantType,
                addedAt: new Date()
            });
            await wishlist.save();
            return res.json({
                success: true,
                added: true,
                message: 'Product added to wishlist',
                wishlistCount: wishlist.products.length
            });
        }
    } catch (error) {
        console.error('Toggle Wishlist Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error updating wishlist'
        });
    }
};

export default {
    viewProduct,
    getProductsByCategory,
    searchProducts,
    toggleWishlist
};
