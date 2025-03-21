import CartItem from '../../model/cartModel.js';
import Product from '../../model/productModel.js';
import User from '../../model/userModel.js';

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

    getCart: async (req, res) => {
        try {
            const userId = req.session.userId;
            const user = await User.findById(userId);

            // Fetch all cart items with product details
            const cartItems = await CartItem.find({ userId })
                .populate({
                    path: 'productId',
                    select: 'name images variants status'
                })
                .sort({ createdAt: -1 });

            // Calculate cart totals (only for active products)
            let subtotal = 0;
            const shippingCost = 40; // Fixed shipping cost
            
            const processedItems = cartItems.map(item => {
                // Skip calculation for inactive products
                if (!item.productId || item.productId.status !== 'Active') {
                    return {
                        ...item.toObject(),
                        price: 0,
                        discount: 0,
                        discountedPrice: 0,
                        totalPrice: 0,
                        stock: 0
                    };
                }

                const variant = item.productId.variants.find(v => v.type === item.variantType);
                const price = variant ? variant.price : 0;
                const discount = variant ? variant.discount : 0;
                const discountedPrice = Math.round(price * (1 - discount/100));
                const totalPrice = discountedPrice * item.quantity;
                
                // Only add to subtotal if product is active
                if (item.productId.status === 'Active') {
                    subtotal += totalPrice;
                }
                
                return {
                    ...item.toObject(),
                    price: price,
                    discount: discount,
                    discountedPrice: discountedPrice,
                    totalPrice: totalPrice,
                    stock: variant ? variant.stock : 0
                };
            });

            const total = subtotal + shippingCost;

            res.render('user/cart', {
                title: 'Cart',
                user,
                cartItems: processedItems,
                subtotal,
                shippingCost,
                total,
                currentPage: 'cart'
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
