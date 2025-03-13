import Product from '../../model/productModel.js';
import Category from '../../model/categoryModel.js';
import User from '../../model/userModel.js';

const getProductDetails = async (req, res) => {
    try {
        const productId = req.params.productId;
        const userId = req.session.userId;

        // Get product details with category
        const product = await Product.findOne({ 
            _id: productId, 
            status: 'Active' 
        }).populate('category');

        if (!product) {
            return res.status(404).render('error', { 
                message: 'Product not found' 
            });
        }

        // Get user details (for wishlist check if needed)
        const user = await User.findById(userId);
        if (!user) {
            return res.redirect('/login');
        }

        // Calculate discounted prices for variants
        const variants = product.variants.map(variant => ({
            ...variant.toObject(),
            discountedPrice: Math.round(variant.price - (variant.price * product.discount / 100))
        }));

        // Get similar products
        const similarProducts = await Product.find({
            category: product.category._id,
            _id: { $ne: product._id },
            status: 'Active'
        })
        .populate('category')
        .limit(4);

        res.render('user/product', {
            product: {
                ...product.toObject(),
                variants
            },
            similarProducts,
            user
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

export default {
    getProductDetails,
    getProductsByCategory,
    searchProducts
};
