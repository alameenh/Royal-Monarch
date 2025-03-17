import Product from '../../model/productModel.js';
import Category from '../../model/categoryModel.js';

const getShopPage = async (req, res) => {
    try {
        // Get all categories
        const categories = await Category.find({ status: 'Active' });
        res.render('user/shop', { categories });
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
        const minPrice = parseInt(req.query.minPrice) || 0;
        const maxPrice = parseInt(req.query.maxPrice) || Number.MAX_SAFE_INTEGER;

        // Build base query
        let query = {
            status: 'Active',
            'variants.price': { $gte: minPrice, $lte: maxPrice }
        };

        // Add search conditions
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { brand: { $regex: search, $options: 'i' } }
            ];
        }

        // Add category condition with active status check
        if (category) {
            // First check if category is active
            const activeCategory = await Category.findOne({
                _id: category,
                status: 'Active'
            });

            if (!activeCategory) {
                return res.json({
                    success: true,
                    products: [],
                    pagination: {
                        currentPage: 1,
                        totalPages: 0,
                        totalProducts: 0,
                        hasNextPage: false,
                        hasPrevPage: false
                    }
                });
            }
            query.category = category;
        }

        // Add category status check to all queries
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
                $match: {
                    ...query,
                    'categoryData.status': 'Active'
                }
            },
            {
                $sort: { [sortBy]: order === 'desc' ? -1 : 1 }
            },
            {
                $skip: (page - 1) * limit
            },
            {
                $limit: limit
            }
        ]);

        // Get total count for pagination
        const totalProducts = await Product.aggregate([
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
                    ...query,
                    'categoryData.status': 'Active'
                }
            },
            {
                $count: 'total'
            }
        ]);

        const total = totalProducts[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        res.json({
            success: true,
            products,
            pagination: {
                currentPage: page,
                totalPages,
                totalProducts: total,
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
