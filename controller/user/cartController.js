import CartItem from '../../model/cartModel.js';
import Product from '../../model/productModel.js';
import User from '../../model/userModel.js';
import Offer from '../../model/offerModel.js';

const cartController = {
    addToCart: async (req, res) => {
        try {
            const { productId, variantType } = req.body;
            const userId = req.session.userId;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Please login to add items to cart'
                });
            }

            // Check if product exists and is in stock
            const product = await Product.findById(productId);
            if (!product) {
                return res.status(404).json({
                    success: false,
                    message: 'Product not found'
                });
            }

            // Find the variant
            const variant = product.variants.find(v => v.type === variantType);
            if (!variant) {
                return res.status(404).json({
                    success: false,
                    message: 'Variant not found'
                });
            }

            // Check if product is out of stock
            if (variant.stock <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Product is out of stock',
                    isOutOfStock: true
                });
            }

            // Check if item already exists in cart
            let cartItem = await CartItem.findOne({
                userId,
                productId,
                variantType
            });

            // Check cart limits and stock availability
            if (cartItem) {
                // Check if adding one more would exceed stock
                if (cartItem.quantity >= variant.stock) {
                    return res.status(400).json({
                        success: false,
                        message: 'Maximum stock limit reached',
                        isCartLimit: true,
                        currentQuantity: cartItem.quantity,
                        maxStock: variant.stock
                    });
                }

                // Check if adding one more would exceed maximum cart limit (4)
                if (cartItem.quantity >= 4) {
                    return res.status(400).json({
                        success: false,
                        message: 'Maximum cart limit reached (4 items)',
                        isCartLimit: true,
                        currentQuantity: cartItem.quantity,
                        maxStock: 4
                    });
                }

                // Check if adding one more would exceed available stock
                if (cartItem.quantity + 1 > variant.stock) {
                    return res.status(400).json({
                        success: false,
                        message: 'Not enough stock available',
                        isOutOfStock: true,
                        currentQuantity: cartItem.quantity,
                        availableStock: variant.stock
                    });
                }

                // Increment quantity
                cartItem.quantity += 1;
                await cartItem.save();
            } else {
                // For new items, check if stock is available
                if (variant.stock < 1) {
                    return res.status(400).json({
                        success: false,
                        message: 'Product is out of stock',
                        isOutOfStock: true
                    });
                }

                // Create new cart item
                cartItem = new CartItem({
                    userId,
                    productId,
                    variantType,
                    quantity: 1
                });
                await cartItem.save();
            }

            // Get updated cart count
            const cartCount = await CartItem.countDocuments({ userId });

            res.json({
                success: true,
                message: 'Added to cart successfully',
                cartCount
            });

        } catch (error) {
            console.error('Add to Cart Error:', error);
            res.status(500).json({
                success: false,
                message: 'Error adding to cart',
                error: error.message
            });
        }
    },

    removeFromCart: async (req, res) => {
        try {
            const { productId, variantType } = req.body;
            const userId = req.session.userId;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Please login to remove items from cart'
                });
            }

            // Find and remove the cart item
            await CartItem.findOneAndDelete({
                userId,
                productId,
                variantType
            });

            // Get updated cart count
            const cartCount = await CartItem.countDocuments({ userId });

            res.json({
                success: true,
                message: 'Removed from cart successfully',
                cartCount
            });

        } catch (error) {
            console.error('Remove from Cart Error:', error);
            res.status(500).json({
                success: false,
                message: 'Error removing from cart'
            });
        }
    },

    getCartCount: async (req, res) => {
        try {
            const userId = req.session.userId;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Please login to get cart count'
                });
            }

            const count = await CartItem.countDocuments({ userId });

            res.json({
                success: true,
                count
            });

        } catch (error) {
            console.error('Get Cart Count Error:', error);
            res.status(500).json({
                success: false,
                message: 'Error getting cart count'
            });
        }
    },

    getCart: async (req, res) => {
        try {
            const userId = req.session.userId;
            const cartItems = await CartItem.find({ userId })
                .populate('productId');

            // Get current date for offer validation
            const currentDate = new Date();

            // Fetch all active offers that might apply to cart items
            const activeOffers = await Offer.find({
                isActive: true,
                startDate: { $lte: currentDate },
                endDate: { $gte: currentDate }
            });

            // Process each cart item to include offer details
            const processedCartItems = await Promise.all(cartItems.map(async item => {
                if (!item.productId || item.productId.status !== 'Active') {
                    return item;
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
                const originalPrice = variant ? variant.price : 0;

                // Calculate price after offer
                let priceAfterOffer = originalPrice;
                let offerDiscount = 0;
                if (applicableOffer) {
                    offerDiscount = (originalPrice * applicableOffer.discount) / 100;
                    priceAfterOffer = originalPrice - offerDiscount;
                }

                // Calculate GST and shipping for this item
                const itemGstAmount = Math.round(priceAfterOffer * 0.18);
                const itemShippingCost = Math.round(priceAfterOffer * 0.02);

                // Calculate subtotal for this product after offer
                const subtotalAfterOffer = priceAfterOffer * item.quantity;

                return {
                    ...item.toObject(),
                    originalPrice,
                    priceAfterOffer,
                    offer: applicableOffer,
                    offerDiscountforproduct: offerDiscount * item.quantity,
                    subtotalAfterOffer,
                    gstAmount: itemGstAmount * item.quantity,
                    shippingCost: itemShippingCost * item.quantity,
                    stock: variant ? variant.stock : 0
                };
            }));

            // Calculate total subtotal after offers
            let totalSubtotalAfterOffers = 0;
            let originalSubtotal = 0;
            let totalOfferDiscount = 0;
            let totalGstAmount = 0;
            let totalShippingCost = 0;
            processedCartItems.forEach(item => {
                if (item.productId && item.productId.status === 'Active') {
                    originalSubtotal += item.originalPrice * item.quantity;
                    totalOfferDiscount += item.offerDiscountforproduct;
                    totalSubtotalAfterOffers += item.subtotalAfterOffer;
                    totalGstAmount += item.gstAmount;
                    totalShippingCost += item.shippingCost;
                }
            });

            // Calculate final total
            const total = totalSubtotalAfterOffers + totalGstAmount + totalShippingCost;

            // Get cart count for the navbar
            const cartCount = await CartItem.countDocuments({ userId });

            res.render('user/cart', {
                title: 'Cart',
                user: await User.findById(userId),
                cartItems: processedCartItems,
                originalSubtotal,
                totalOfferDiscount,
                subtotal: totalSubtotalAfterOffers,
                gstAmount: totalGstAmount,
                shippingCost: totalShippingCost,
                total,
                currentPage: 'cart',
                cartCount
            });

        } catch (error) {
            console.error('Get Cart Error:', error);
            res.status(500).render('error', {
                message: 'Failed to load cart'
            });
        }
    },

    updateQuantity: async (req, res) => {
        try {
            const { productId, variantType, quantity } = req.body;
            const userId = req.session.userId;

            // Validate quantity
            if (quantity < 1 || quantity > 4) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid quantity. Must be between 1 and 4'
                });
            }

            // Find the cart item
            const cartItem = await CartItem.findOne({
                userId,
                productId,
                variantType
            });

            if (!cartItem) {
                return res.status(404).json({
                    success: false,
                    message: 'Cart item not found'
                });
            }

            // Only check stock if quantity is being increased
            if (quantity > cartItem.quantity) {
                // Check product stock
                const product = await Product.findById(productId);
                const variant = product.variants.find(v => v.type === variantType);
                
                if (!variant || variant.stock < quantity) {
                    return res.status(400).json({
                        success: false,
                        message: 'Requested quantity not available in stock'
                    });
                }
            }

            // Update quantity
            cartItem.quantity = quantity;
            await cartItem.save();

            const updatedCount = await CartItem.countDocuments({ userId });

            res.json({
                success: true,
                message: 'Quantity updated successfully',
                cartCount: updatedCount
            });

        } catch (error) {
            console.error('Update Quantity Error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update quantity'
            });
        }
    },

    isInCart: async (req, res) => {
        try {
            const { productId, variantType } = req.query;
            const userId = req.session.userId;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Please login to check cart'
                });
            }

            const cartItem = await CartItem.findOne({
                userId,
                productId,
                variantType
            });

            res.json({
                success: true,
                inCart: !!cartItem
            });

        } catch (error) {
            console.error('Check Cart Error:', error);
            res.status(500).json({
                success: false,
                message: 'Error checking cart'
            });
        }
    }
};

export default cartController;
