import Wishlist from '../../model/wishlistModel.js';
import Product from '../../model/productModel.js';
import User from '../../model/userModel.js';
import Offer from '../../model/offerModel.js';
import Cart from '../../model/cartModel.js';

const wishlistController = {
    getWishlist: async (req, res) => {
        try {
            const userId = req.session.userId;
            const wishlist = await Wishlist.findOne({ userId })
                .populate({
                    path: 'products.productId',
                    select: 'name brand images variants category status',
                    populate: {
                        path: 'variants',
                        select: 'type price discount stock'
                    }
                });

            // Get current date for offer validation
            const currentDate = new Date();

            // Fetch all active offers
            const activeOffers = await Offer.find({
                isActive: true,
                startDate: { $lte: currentDate },
                endDate: { $gte: currentDate }
            });

            // Process each wishlist item to include offer details
            const processedWishlistItems = wishlist ? await Promise.all(wishlist.products.map(async item => {
                if (!item.productId || item.productId.status !== 'Active') {
                    return null;
                }

                // Find product-specific offer
                const productOffer = activeOffers.find(offer => 
                    offer.type === 'product' && 
                    offer.productIds.some(id => id.toString() === item.productId._id.toString())
                );

                // Find category offer
                const categoryOffer = activeOffers.find(offer => 
                    offer.type === 'category' && 
                    offer.categoryId.toString() === item.productId.category.toString()
                );

                // Use product offer if available, otherwise use category offer
                const applicableOffer = productOffer || categoryOffer;

                // Find the variant price
                const variant = item.productId.variants.find(v => v.type === item.variantType);
                if (!variant) {
                    return null; // Skip items with invalid variants
                }

                const originalPrice = variant.price;

                // Calculate price after offer
                let priceAfterOffer = originalPrice;
                let offerDiscount = 0;
                if (applicableOffer) {
                    offerDiscount = (originalPrice * applicableOffer.discount) / 100;
                    priceAfterOffer = originalPrice - offerDiscount;
                }

                // Ensure product has required fields
                const product = {
                    _id: item.productId._id,
                    name: item.productId.name,
                    brand: item.productId.brand,
                    images: item.productId.images || [],
                    category: item.productId.category,
                    status: item.productId.status,
                    variants: item.productId.variants || []
                };

                return {
                    ...item.toObject(),
                    productId: product,
                    originalPrice,
                    priceAfterOffer,
                    offer: applicableOffer,
                    offerDiscount,
                    stock: variant.stock
                };
            })) : [];

            // Filter out null items (inactive products or invalid variants)
            const validWishlistItems = processedWishlistItems
                .filter(item => item !== null)
                .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt)); // Sort by addedAt in descending order

            // Get wishlist count for the navbar
            const wishlistCount = validWishlistItems.length;

            res.render('user/wishlist', {
                title: 'Wishlist',
                user: await User.findById(userId),
                wishlistItems: validWishlistItems,
                currentPage: 'wishlist',
                wishlistCount
            });

        } catch (error) {
            console.error('Get Wishlist Error:', error);
            res.status(500).render('error', {
                message: 'Failed to load wishlist'
            });
        }
    },

    addToWishlist: async (req, res) => {
        try {
            const { productId, variantType } = req.body;
            const userId = req.session.userId;

            // Validate inputs
            if (!productId || !variantType) {
                return res.status(400).json({
                    success: false,
                    message: 'Product ID and variant type are required'
                });
            }

            // Check if product exists and is active
            const product = await Product.findOne({ 
                _id: productId,
                status: 'Active'
            });

            if (!product) {
                return res.status(404).json({
                    success: false,
                    message: 'Product not found or unavailable'
                });
            }

            // Find the variant and validate it exists
            const variant = product.variants.find(v => v.type === variantType);
            if (!variant) {
                return res.status(404).json({
                    success: false,
                    message: 'Variant not found'
                });
            }

            // Find or create wishlist
            let wishlist = await Wishlist.findOne({ userId });
            if (!wishlist) {
                wishlist = new Wishlist({ userId, products: [] });
            }

            // Check if product is already in wishlist
            const existingItem = wishlist.products.find(
                item => item.productId.toString() === productId && item.variantType === variantType
            );

            if (existingItem) {
                return res.status(400).json({
                    success: false,
                    message: 'Product is already in wishlist'
                });
            }

            // Add to wishlist
            wishlist.products.push({
                productId,
                variantType,
                addedAt: new Date()
            });

            await wishlist.save();

            const updatedCount = wishlist.products.length;

            res.json({
                success: true,
                message: 'Added to wishlist',
                wishlistCount: updatedCount
            });

        } catch (error) {
            console.error('Add to Wishlist Error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to add to wishlist'
            });
        }
    },

    removeFromWishlist: async (req, res) => {
        try {
            const { productId, variantType } = req.body;
            const userId = req.session.userId;

            const wishlist = await Wishlist.findOne({ userId });
            if (!wishlist) {
                return res.status(404).json({
                    success: false,
                    message: 'Wishlist not found'
                });
            }

            // Remove the item
            wishlist.products = wishlist.products.filter(
                item => !(item.productId.toString() === productId && item.variantType === variantType)
            );

            await wishlist.save();

            const updatedCount = wishlist.products.length;

            res.json({
                success: true,
                message: 'Removed from wishlist',
                wishlistCount: updatedCount
            });

        } catch (error) {
            console.error('Remove from Wishlist Error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to remove from wishlist'
            });
        }
    },

    getWishlistCount: async (req, res) => {
        try {
            const wishlist = await Wishlist.findOne({ userId: req.session.userId });
            const count = wishlist ? wishlist.products.length : 0;
            res.json({ count });
        } catch (error) {
            console.error('Error getting wishlist count:', error);
            res.status(500).json({ count: 0 });
        }
    },

    // Toggle wishlist
    toggleWishlist: async (req, res) => {
        try {
            const userId = req.session.userId;
            const { productId } = req.params;
            const { variantType } = req.body;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Please login to add items to wishlist'
                });
            }

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }

            const product = await Product.findOne({
                _id: productId,
                status: 'Active'
            });

            if (!product) {
                return res.status(404).json({
                    success: false,
                    message: 'Product not found or unavailable'
                });
            }

            const variant = product.variants.find(v => v.type === variantType);
            if (!variant) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid variant selected'
                });
            }

            let wishlist = await Wishlist.findOne({ userId });
            if (!wishlist) {
                wishlist = new Wishlist({ userId, products: [] });
            }

            const existingItem = wishlist.products.find(
                item => item.productId.toString() === productId && item.variantType === variantType
            );

            if (existingItem) {
                // Remove from wishlist
                wishlist.products = wishlist.products.filter(
                    item => !(item.productId.toString() === productId && item.variantType === variantType)
                );
                await wishlist.save();

                // Get updated wishlist count
                const updatedWishlist = await Wishlist.findOne({ userId });
                const wishlistCount = updatedWishlist ? updatedWishlist.products.length : 0;

                return res.json({
                    success: true,
                    added: false,
                    message: 'Product removed from wishlist',
                    wishlistCount
                });
            } else {
                // Add to wishlist
                wishlist.products.push({
                    productId,
                    variantType,
                    addedAt: new Date()
                });
                await wishlist.save();

                // Get updated wishlist count
                const updatedWishlist = await Wishlist.findOne({ userId });
                const wishlistCount = updatedWishlist ? updatedWishlist.products.length : 0;

                return res.json({
                    success: true,
                    added: true,
                    message: 'Product added to wishlist',
                    wishlistCount
                });
            }
        } catch (error) {
            console.error('Toggle Wishlist Error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to update wishlist'
            });
        }
    },
};

export default wishlistController;
