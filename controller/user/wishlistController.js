import Wishlist from '../../model/wishlistModel.js';
import Product from '../../model/productModel.js';
import User from '../../model/userModel.js';
import Offer from '../../model/offerModel.js';

const getWishlist = async (req, res) => {
    try {
        const userId = req.session.userId;
        if (!userId) {
            return res.redirect('/login');
        }

        // Get user details for sidebar
        const user = await User.findById(userId).select('-password');
        if (!user) {
            return res.redirect('/login');
        }

        // Get user's wishlist with populated product details
        const wishlist = await Wishlist.findOne({ userId })
            .populate({
                path: 'products.productId',
                select: 'name brand images variants category status',
                populate: {
                    path: 'category',
                    select: 'name status'
                }
            });

        if (!wishlist) {
            return res.render('user/wishlist', { 
                wishlistItems: [],
                message: 'Your wishlist is empty',
                user,
                currentPage: 'wishlist'
            });
        }

        // Filter out products with inactive categories and inactive products
        const wishlistItems = wishlist.products
            .filter(item => 
                item.productId && 
                item.productId.status === 'Active' && 
                item.productId.category && 
                item.productId.category.status === 'Active' &&
                // Ensure variant type is valid
                ['Full option', 'Base'].includes(item.variantType)
            )
            .map(item => {
                const productData = item.productId.toObject();
                // Find the specific variant that matches the wishlist item
                const variant = productData.variants.find(v => v.type === item.variantType);
                return {
                    ...productData,
                    variantType: item.variantType,
                    addedAt: item.addedAt,
                    // Ensure we have the correct variant data
                    variants: variant ? [variant] : productData.variants
                };
            });

        // Sort by addedAt date (newest first)
        wishlistItems.sort((a, b) => {
            const dateA = new Date(a.addedAt);
            const dateB = new Date(b.addedAt);
            return dateB - dateA;
        });

        // Get current date for offer validation
        const currentDate = new Date();

        // Fetch all active offers
        const activeOffers = await Offer.find({
            isActive: true,
            startDate: { $lte: currentDate },
            endDate: { $gte: currentDate }
        });

        // Process each product to include offer information
        const processedWishlistItems = wishlistItems.map(item => {
            // Find applicable offers for this product
            const productOffer = activeOffers.find(offer => 
                offer.type === 'product' && 
                offer.productIds.some(id => id.toString() === item._id.toString())
            );

            const categoryOffer = activeOffers.find(offer => 
                offer.type === 'category' && 
                offer.categoryId.toString() === item.category._id.toString()
            );

            // Prioritize product offer over category offer
            const applicableOffer = productOffer || categoryOffer;

            // Apply the best discount to each variant
            const variants = item.variants.map(variant => {
                const variantDiscount = variant.discount || 0;
                const offerDiscount = applicableOffer ? applicableOffer.discount : 0;
                const bestDiscount = Math.max(variantDiscount, offerDiscount);
                
                return {
                    ...variant,
                    discountedPrice: Math.round(variant.price * (1 - bestDiscount/100)),
                    discount: bestDiscount,
                    offerName: applicableOffer ? applicableOffer.name : null
                };
            });

            return {
                ...item,
                variants,
                offer: applicableOffer
            };
        });

        res.render('user/wishlist', { 
            wishlistItems: processedWishlistItems,
            message: processedWishlistItems.length === 0 ? 'Your wishlist is empty' : null,
            user,
            currentPage: 'wishlist'
        });
    } catch (error) {
        console.error('Get Wishlist Error:', error);
        res.status(500).render('error', { 
            message: 'Error loading wishlist' 
        });
    }
};

const removeFromWishlist = async (req, res) => {
    try {
        const { productId, variantType } = req.body;
        const userId = req.session.userId;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Please login to manage wishlist'
            });
        }

        if (!productId || !variantType) {
            return res.status(400).json({
                success: false,
                message: 'Product ID and Variant Type are required'
            });
        }

        const wishlist = await Wishlist.findOne({ userId });
        if (!wishlist) {
            return res.status(404).json({
                success: false,
                message: 'Wishlist not found'
            });
        }

        // Check if the product with specific variant exists in wishlist
        const exists = wishlist.products.some(
            item => item.productId.toString() === productId && item.variantType === variantType
        );

        if (!exists) {
            return res.status(404).json({
                success: false,
                message: 'Product variant not found in wishlist'
            });
        }

        // Remove the specific product with its variant
        wishlist.products = wishlist.products.filter(
            item => !(item.productId.toString() === productId && item.variantType === variantType)
        );

        await wishlist.save();

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
