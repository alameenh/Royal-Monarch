import Product from '../../model/productModel.js';
import Category from '../../model/categoryModel.js';

const getShopPage = async (req, res) => {
    try {
        // Get all categories for filter
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

        // Build query
        const query = {
            status: 'Active',
            'variants.price': { $gte: minPrice, $lte: maxPrice }
        };

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { brand: { $regex: search, $options: 'i' } }
            ];
        }

        if (category) {
            query.category = category;
        }

        // Build sort object
        let sortObject = {};
        switch (sortBy) {
            case 'price':
                sortObject['variants.0.price'] = order === 'asc' ? 1 : -1;
                break;
            case 'name':
                sortObject.name = order === 'asc' ? 1 : -1;
                break;
            default:
                sortObject[sortBy] = order === 'asc' ? 1 : -1;
        }

        const totalProducts = await Product.countDocuments(query);
        const totalPages = Math.ceil(totalProducts / limit);
        const skip = (page - 1) * limit;

        const products = await Product.find(query)
            .populate('category')
            .sort(sortObject)
            .skip(skip)
            .limit(limit);

        res.json({
            success: true,
            products,
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
