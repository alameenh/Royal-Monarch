import Product from '../../model/productModel.js';
import Category from '../../model/categoryModel.js';
import User from '../../model/userModel.js';
import mongoose from 'mongoose';

const getProductDetails = async (req, res) => {
    try {
        const productId = req.params.productId;
        
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
            similarProducts
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

export default {
    getProductDetails,
    getProductsByCategory,
    searchProducts
};
