import Order from '../../model/orderModel.js';
import CartItem from '../../model/cartModel.js';
import Address from '../../model/addressModel.js';
import User from '../../model/userModel.js';
import { v4 as uuidv4 } from 'uuid';

const orderController = {
    getCheckout: async (req, res) => {
        try {
            const userId = req.session.userId;
            const user = await User.findById(userId);

            // Fetch cart items
            const cartItems = await CartItem.find({ userId })
                .populate({
                    path: 'productId',
                    select: 'name images variants status'
                });

            // Filter active products and calculate totals
            const activeItems = cartItems.filter(item => 
                item.productId && item.productId.status === 'Active'
            );

            if (activeItems.length === 0) {
                return res.redirect('/cart');
            }

            let subtotal = 0;
            const processedItems = activeItems.map(item => {
                const variant = item.productId.variants.find(v => v.type === item.variantType);
                const price = variant ? variant.price : 0;
                const discount = variant ? variant.discount : 0;
                const discountedPrice = Math.round(price * (1 - discount/100));
                const totalPrice = discountedPrice * item.quantity;
                subtotal += totalPrice;
                
                return {
                    ...item.toObject(),
                    price,
                    discount,
                    discountedPrice,
                    totalPrice
                };
            });

            // Fetch addresses
            const addresses = await Address.find({ userId });

            const shippingCost = 40;
            const total = subtotal + shippingCost;

            res.render('user/checkout', {
                user,
                cartItems: processedItems,
                addresses,
                subtotal,
                shippingCost,
                total,
                currentPage: 'checkout'
            });

        } catch (error) {
            console.error('Checkout Error:', error);
            res.status(500).render('error', {
                message: 'Error loading checkout page'
            });
        }
    },

    createOrder: async (req, res) => {
        try {
            const userId = req.session.userId;
            const { addressId, paymentMethod } = req.body;

            // Validate address
            const address = await Address.findOne({ _id: addressId, userId });
            if (!address) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid address selected'
                });
            }

            // Get cart items
            const cartItems = await CartItem.find({ userId })
                .populate('productId');

            // Filter and process active items
            const orderItems = cartItems
                .filter(item => item.productId && item.productId.status === 'Active')
                .map(item => {
                    const variant = item.productId.variants.find(v => v.type === item.variantType);
                    const price = variant.price;
                    const discount = variant.discount;
                    
                    return {
                        name: item.productId.name,
                        brand: item.productId.brand,
                        variant: item.variantType,
                        images: item.productId.images,
                        quantity: item.quantity,
                        price: price,
                        discount: discount
                    };
                });

            if (orderItems.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No active items in cart'
                });
            }

            // Calculate total
            const totalAmount = orderItems.reduce((sum, item) => {
                const discountedPrice = item.price * (1 - item.discount/100);
                return sum + (discountedPrice * item.quantity);
            }, 0) + 40; // Adding shipping cost

            // Create order
            const order = new Order({
                orderId: `ORD${uuidv4().substring(0, 8).toUpperCase()}`,
                userId,
                items: orderItems,
                totalAmount,
                paymentMethod,
                paymentStatus: paymentMethod === 'cod' ? 'unpaid' : 'pending',
                shippingAddress: {
                    name: address.name,
                    houseName: address.houseName,
                    localityStreet: address.localityStreet,
                    city: address.city,
                    state: address.state,
                    pincode: address.pincode,
                    phone: address.phone,
                    alternatePhone: address.alternatePhone
                },
                expectedDeliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from now
            });

            await order.save();

            // Clear cart after successful order
            await CartItem.deleteMany({ userId });

            res.json({
                success: true,
                message: 'Order placed successfully',
                orderId: order.orderId,
                paymentMethod
            });

        } catch (error) {
            console.error('Create Order Error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to create order'
            });
        }
    }
};

export default orderController;
