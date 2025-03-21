import Wishlist from '../../model/wishlistModel.js';
import Product from '../../model/productModel.js';
import User from '../../model/userModel.js';

const getWishlist = async (req, res) => {
    try {
        const userId = req.session.userId;

        // Get user details for sidebar
        const user = await User.findById(userId);
        
        // Find user's wishlist and populate product details
        const wishlist = await Wishlist.findOne({ userId })
            .populate({
                path: 'products',
                match: { status: 'Active' }, // Only get active products
                populate: {
                    path: 'category',
                    match: { status: 'Active' } // Only get products from active categories
                }
            });

        // Filter out products where category is null (inactive categories)
        const wishlistItems = wishlist ? 
            wishlist.products.filter(product => product.category !== null) : [];

        res.render('user/wishlist', {
            wishlistItems,
            user,
            currentPage: 'wishlist'
        });

    } catch (error) {
        console.error('Wishlist Error:', error);
        res.status(500).render('error', {
            message: 'Error loading wishlist'
        });
    }
};

// Remove product from wishlist
const removeFromWishlist = async (req, res) => {
    try {
        const userId = req.session.userId;
        const productId = req.params.productId;

        const result = await Wishlist.updateOne(
            { userId },
            { $pull: { products: productId } }
        );

        if (result.modifiedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Product not found in wishlist'
            });
        }

        res.json({
            success: true,
            message: 'Product removed from wishlist'
        });

    } catch (error) {
        console.error('Remove from Wishlist Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error removing product from wishlist'
        });
    }
};

export default {
    getWishlist,
    removeFromWishlist
};
