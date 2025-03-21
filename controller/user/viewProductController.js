import Product from '../../model/productModel.js';
import Category from '../../model/categoryModel.js';
import User from '../../model/userModel.js';
import Wishlist from '../../model/wishlistModel.js';
import mongoose from 'mongoose';

const getProductDetails = async (req, res) => {
    try {
        const productId = req.params.productId;
        const userId = req.session.userId;
        
        // Fetch product and check both product and category status
        const product = await Product.aggregate([
            {
                $match: {
                    _id: new mongoose.Types.ObjectId(productId)
                }
            },
            {
                $lookup: {
                    from: 'categories',
                    localField: 'category',
                    foreignField: '_id',
                    as: 'categoryData'
                }
            },
            {
                $match: {
                    'categoryData.status': 'Active',  // Only if category is active
                    status: 'Active'  // Only if product is active
                }
            }
        ]);

        if (!product || product.length === 0) {
            return res.status(404).render('error', { 
                message: 'Product not found or unavailable' 
            });
        }

        // Get the first (and only) product from aggregate result
        const productData = product[0];

        // Calculate discounted prices for variants
        productData.variants = productData.variants.map(variant => ({
            ...variant,
            discountedPrice: Math.round(variant.price * (1 - productData.discount / 100))
        }));

        // Check if the product is in user's wishlist
        let isInWishlist = false;
        if (userId) {
            const wishlist = await Wishlist.findOne({ 
                userId: userId,
                products: new mongoose.Types.ObjectId(productId)
            });
            isInWishlist = !!wishlist;
        }

        // Fetch similar products (also only from active categories)
        const similarProducts = await Product.aggregate([
            {
                $match: {
                    category: productData.category,
                    _id: { $ne: new mongoose.Types.ObjectId(productId) },
                    status: 'Active'
                }
            },
            {
                $lookup: {
                    from: 'categories',
                    localField: 'category',
                    foreignField: '_id',
                    as: 'categoryData'
                }
            },
            {
                $match: {
                    'categoryData.status': 'Active'
                }
            },
            {
                $limit: 4
            }
        ]);

        return res.render('user/viewProduct', {
            product: productData,
            similarProducts,
            isInWishlist: isInWishlist
        });

    } catch (error) {
        console.error('View Product Error:', error);
        return res.status(500).render('error', { 
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
        const WISHLIST_LIMIT = 10;  // Define the wishlist limit
        
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Please login to add items to wishlist'
            });
        }
        
        // Find user's wishlist
        let wishlist = await Wishlist.findOne({ userId });
        
        // If no wishlist exists, create one
        if (!wishlist) {
            wishlist = new Wishlist({
                userId,
                products: [productId]
            });
            await wishlist.save();
            return res.json({
                success: true,
                added: true,
                message: 'Product added to wishlist'
            });
        }
        
        // Check if product is already in wishlist
        const productIndex = wishlist.products.indexOf(productId);
        
        if (productIndex > -1) {
            // Remove from wishlist
            wishlist.products.splice(productIndex, 1);
            await wishlist.save();
            return res.json({
                success: true,
                added: false,
                message: 'Product removed from wishlist'
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
            wishlist.products.push(productId);
            await wishlist.save();
            return res.json({
                success: true,
                added: true,
                message: 'Product added to wishlist'
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
    getProductDetails,
    getProductsByCategory,
    searchProducts,
    toggleWishlist
};
