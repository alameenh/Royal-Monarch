import CartItem from '../../model/cartModel.js';
import Product from '../../model/productModel.js';
import User from '../../model/userModel.js';
import Offer from '../../model/offerModel.js';

const cartController = {
    addToCart: async (req, res) => {
        try {
            const { productId, variantType } = req.body;
            const userId = req.session.userId;

            // Validate inputs
            if (!productId || !variantType || typeof variantType !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid product or variant data'
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

            // Check stock
            if (variant.stock <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Product is out of stock'
                });
            }

            // Check total number of items in cart
            const cartCount = await CartItem.countDocuments({ userId });
            if (cartCount >= 10) {
                return res.status(400).json({
                    success: false,
                    message: 'Cart is full (maximum 10 items)'
                });
            }

            // Check if this exact variant is already in cart
            const existingItem = await CartItem.findOne({
                userId,
                productId,
                variantType
            });

            if (existingItem) {
                if (existingItem.quantity < 4) {
                    existingItem.quantity += 1;
                    await existingItem.save();
                    return res.json({
                        success: true,
                        message: 'Item quantity updated in cart'
                    });
                } else {
                    return res.status(400).json({
                        success: false,
                        message: 'Maximum quantity limit reached for this variant'
                    });
                }
            }

            // Add new variant to cart
            const cartItem = new CartItem({
                userId,
                productId,
                variantType,
                quantity: 1
            });

            await cartItem.save();

            res.json({
                success: true,
                message: 'Item added to cart'
            });

        } catch (error) {
            console.error('Add to Cart Error:', error);
            // Check if error is due to duplicate key (trying to add same variant)
            if (error.code === 11000) {
                return res.status(400).json({
                    success: false,
                    message: 'This variant is already in your cart'
                });
            }
            res.status(500).json({
                success: false,
                message: 'Failed to add item to cart'
            });
        }
    },

    removeFromCart: async (req, res) => {
        try {
            const { productId, variantType } = req.body;
            const userId = req.session.userId;

            const result = await CartItem.findOneAndDelete({
                userId,
                productId,
                variantType
            });

            if (!result) {
                return res.status(404).json({
                    success: false,
                    message: 'Item not found in cart'
                });
            }

            res.json({
                success: true,
                message: 'Item removed from cart'
            });

        } catch (error) {
            console.error('Remove from Cart Error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to remove item from cart'
            });
        }
    },

    getCartCount: async (req, res) => {
        try {
            const userId = req.session.userId;
            if (!userId) {
                return res.json({ count: 0 });
            }
            
            const count = await CartItem.countDocuments({ userId });
            res.json({ count });
        } catch (error) {
            console.error('Get Cart Count Error:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Failed to get cart count',
                count: 0
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

            // Check product stock
            const product = await Product.findById(productId);
            const variant = product.variants.find(v => v.type === variantType);
            
            if (!variant || variant.stock < quantity) {
                return res.status(400).json({
                    success: false,
                    message: 'Requested quantity not available in stock'
                });
            }

            // Update quantity
            cartItem.quantity = quantity;
            await cartItem.save();

            res.json({
                success: true,
                message: 'Quantity updated successfully'
            });

        } catch (error) {
            console.error('Update Quantity Error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update quantity'
            });
        }
    }
};

export default cartController;
