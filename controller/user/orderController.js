import Order from '../../model/orderModel.js';
import CartItem from '../../model/cartModel.js';
import Address from '../../model/addressModel.js';
import User from '../../model/userModel.js';
import { v4 as uuidv4 } from 'uuid';
import Product from '../../model/productModel.js';
import PDFDocument from 'pdfkit';
import Offer from '../../model/offerModel.js';
import Coupon from '../../model/couponModel.js';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import Wallet from '../../model/walletModel.js';

// Initialize Razorpay with proper configuration
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Add this function to verify Razorpay initialization
const verifyRazorpayConfig = () => {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        throw new Error('Razorpay configuration is missing');
    }
    console.log('Razorpay Config:', {
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: '****' + process.env.RAZORPAY_KEY_SECRET.slice(-4)
    });
};

const orderController = {
    getCheckout: async (req, res) => {
        try {
            const userId = req.session.userId;
            const user = await User.findById(userId);
            
            // Get wallet balance
            const wallet = await Wallet.findOne({ userId });
            const walletBalance = wallet ? wallet.balance : 0;

            // Fetch addresses for the user
            const addresses = await Address.find({ userId });

            // Fetch cart items with product details
            const cartItems = await CartItem.find({ userId })
                .populate({
                    path: 'productId',
                    select: 'name images variants brand status category'
                })
                .lean();

            // Fetch all active offers
            const activeOffers = await Offer.find({
                isActive: true,
                startDate: { $lte: new Date() },
                endDate: { $gte: new Date() }
            }).lean();

            let originalSubtotal = 0;
            let totalOfferDiscount = 0;

            // Process each cart item with offers and calculate prices
            const processedCartItems = cartItems.map(item => {
                if (!item.productId || item.productId.status !== 'Active') return null;

                const variant = item.productId.variants.find(v => v.type === item.variantType);
                const originalPrice = variant.price;
                
                // Find applicable offers
                const productOffer = activeOffers.find(offer => 
                    offer.type === 'product' && 
                    offer.productIds.some(id => id.toString() === item.productId._id.toString())
                );

                const categoryOffer = activeOffers.find(offer => 
                    offer.type === 'category' && 
                    offer.categoryId.toString() === item.productId.category.toString()
                );

                // Apply best offer
                const applicableOffer = productOffer || categoryOffer;
                let offerDiscount = 0;
                let discountedPrice = originalPrice;

                if (applicableOffer) {
                    offerDiscount = (originalPrice * applicableOffer.discount) / 100;
                    discountedPrice = originalPrice - offerDiscount;
                    totalOfferDiscount += offerDiscount * item.quantity;
                }

                originalSubtotal += originalPrice * item.quantity;

                return {
                    ...item,
                    originalPrice,
                    discountedPrice,
                    totalPrice: discountedPrice * item.quantity,
                    offer: applicableOffer ? {
                        name: applicableOffer.name,
                        type: applicableOffer.type,
                        discount: applicableOffer.discount
                    } : null
                };
            }).filter(Boolean);

            // Calculate totals
            const subtotalAfterOffers = originalSubtotal - totalOfferDiscount;
            const gstAmount = Math.round(subtotalAfterOffers * 0.18);
            const shippingCost = Math.round(subtotalAfterOffers * 0.02);
            const total = subtotalAfterOffers + gstAmount + shippingCost;

            // Fetch eligible coupons
            const validCoupons = await Coupon.find({
                isActive: true,
                startDate: { $lte: new Date() },
                expiryDate: { $gte: new Date() },
                minPurchase: { $lte: subtotalAfterOffers }
            }).lean();

            const eligibleCoupons = validCoupons.filter(coupon => {
                const userUsage = coupon.usageHistory.filter(
                    history => history.userId.toString() === userId.toString()
                ).length;
                return userUsage < coupon.usageLimit;
            });

            res.render('user/checkout', {
                title: 'Checkout',
                user,
                cartItems: processedCartItems,
                addresses,
                originalSubtotal,
                subtotal: subtotalAfterOffers,
                totalOfferDiscount,
                gstAmount,
                shippingCost,
                total,
                coupons: eligibleCoupons,
                walletBalance,
                razorpayKey: process.env.RAZORPAY_KEY_ID,
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
            console.log('Create order request received');
            
            const userId = req.session.userId;
            const { addressId, paymentMethod, coupon, totalAmount, items: clientItems, originalSubtotal, totalOfferDiscount, totalCouponDiscount, subtotal: clientSubtotal, gstAmount: clientGstAmount, shippingCost: clientShippingCost } = req.body;
            
            console.log('Request data:', { 
                addressId, 
                paymentMethod, 
                totalAmount,
                originalSubtotal,
                totalOfferDiscount,
                totalCouponDiscount,
                clientSubtotal,
                clientGstAmount,
                clientShippingCost,
                itemsCount: clientItems ? clientItems.length : 0
            });

            // Validate address
            const address = await Address.findOne({ _id: addressId, userId });
            if (!address) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid address selected'
                });
            }

            // Get cart items with product details
            const cartItems = await CartItem.find({ userId })
                .populate({
                    path: 'productId',
                    select: 'name images variants brand status category'
                });

            if (!cartItems.length) {
                return res.status(400).json({
                    success: false,
                    message: 'Cart is empty'
                });
            }

            // Check if we have client-provided items with all the required fields
            const useClientItems = clientItems && clientItems.length > 0 && 
                                  clientItems[0].productId && 
                                  clientItems[0].originalPrice !== undefined &&
                                  clientItems[0].priceAfterOffer !== undefined &&
                                  clientItems[0].finalAmount !== undefined &&
                                  clientItems[0].gstAmount !== undefined &&
                                  clientItems[0].shippingCost !== undefined;

            console.log('Using client items:', useClientItems);

            // Check stock availability before creating order
            for (const item of cartItems) {
                const product = await Product.findById(item.productId._id);
                if (!product) {
                    throw new Error(`Product ${item.productId._id} not found`);
                }

                const variant = product.variants.find(v => v.type === item.variantType);
                if (!variant) {
                    throw new Error(`Variant ${item.variantType} not found for ${product.name}`);
                }

                if (variant.stock < item.quantity) {
                    throw new Error(`Insufficient stock for ${product.name} (${item.variantType})`);
                }

                // Decrease stock
                variant.stock -= item.quantity;
                await product.save();
            }

            let orderItems = [];
            let calculatedOriginalSubtotal = 0;
            let calculatedTotalOfferDiscount = 0;
            let calculatedSubtotalAfterOffers = 0;
            
            if (useClientItems) {
                // Use the processed items from the client
                orderItems = clientItems.map(item => {
                    return {
                        productId: item.productId,
                        name: item.name,
                        brand: item.brand,
                        category: item.category,
                        images: item.images,
                        quantity: item.quantity,
                        originalPrice: item.originalPrice,
                        variantType: item.variantType,
                        status: 'pending',
                        previousStatus: 'pending',
                        offer: item.offer,
                        offerDiscount: item.offerDiscount || 0,
                        priceAfterOffer: item.priceAfterOffer,
                        couponForProduct: item.couponForProduct,
                        couponDiscount: item.couponDiscount || 0,
                        subtotalforproduct: item.subtotalforproduct,
                        finalPrice: item.finalPrice,
                        finalAmount: item.finalAmount,
                        gstAmount: item.gstAmount,
                        shippingCost: item.shippingCost
                    };
                });
                
                // Use the provided totals
                calculatedOriginalSubtotal = originalSubtotal;
                calculatedTotalOfferDiscount = totalOfferDiscount;
                calculatedSubtotalAfterOffers = clientSubtotal;
            } else {
                // Fetch active offers
                const activeOffers = await Offer.find({
                    isActive: true,
                    startDate: { $lte: new Date() },
                    endDate: { $gte: new Date() }
                });
                
                // Process each cart item to create order items
                for (const item of cartItems) {
                    if (!item.productId || item.productId.status !== 'Active') continue;

                    const variant = item.productId.variants.find(v => v.type === item.variantType);
                    const originalPrice = variant.price;
                    
                    // Find applicable offers
                    const productOffer = activeOffers.find(offer => 
                        offer.type === 'product' && 
                        offer.productIds.some(id => id.toString() === item.productId._id.toString())
                    );

                    const categoryOffer = activeOffers.find(offer => 
                        offer.type === 'category' && 
                        offer.categoryId.toString() === item.productId.category.toString()
                    );

                    // Apply best offer
                    const applicableOffer = productOffer || categoryOffer;
                    let offerDiscount = 0;
                    let priceAfterOffer = originalPrice;

                    if (applicableOffer) {
                        offerDiscount = (originalPrice * applicableOffer.discount) / 100;
                        priceAfterOffer = originalPrice - offerDiscount;
                        calculatedTotalOfferDiscount += offerDiscount * item.quantity;
                    }

                    // Calculate subtotal for product
                    const subtotalForProduct = priceAfterOffer * item.quantity;
                    calculatedOriginalSubtotal += originalPrice * item.quantity;
                    
                    // Calculate GST and shipping for this item
                    const itemGstAmount = Math.round(subtotalForProduct * 0.18);
                    const itemShippingCost = Math.round(subtotalForProduct * 0.02);
                    const finalPrice = priceAfterOffer;
                    const finalAmount = subtotalForProduct;

                    // Create order item with all required fields
                    const orderItem = {
                        productId: item.productId._id,
                        name: item.productId.name,
                        brand: item.productId.brand,
                        category: item.productId.category,
                        images: item.productId.images,
                        quantity: item.quantity,
                        originalPrice: originalPrice,
                        variantType: item.variantType,
                        status: 'pending',
                        previousStatus: 'pending',
                        offer: applicableOffer ? {
                            name: applicableOffer.name,
                            type: applicableOffer.type,
                            discount: applicableOffer.discount
                        } : null,
                        offerDiscount: offerDiscount,
                        priceAfterOffer: priceAfterOffer,
                        couponForProduct: null,
                        couponDiscount: 0,
                        subtotalforproduct: subtotalForProduct,
                        finalPrice: finalPrice,
                        finalAmount: finalAmount,
                        gstAmount: itemGstAmount,
                        shippingCost: itemShippingCost
                    };

                    orderItems.push(orderItem);
                }
                
                // Calculate subtotal after offers
                calculatedSubtotalAfterOffers = calculatedOriginalSubtotal - calculatedTotalOfferDiscount;
            }

            // Apply coupon if provided
            let couponDetails = null;
            let calculatedTotalCouponDiscount = totalCouponDiscount || 0;
            
            if (coupon) {
                // Verify coupon is still valid
                const validCoupon = await Coupon.findOne({
                    _id: coupon.id,
                    isActive: true,
                    startDate: { $lte: new Date() },
                    expiryDate: { $gte: new Date() },
                    minPurchase: { $lte: calculatedSubtotalAfterOffers }
                });

                if (!validCoupon) {
                    throw new Error('Coupon is no longer valid');
                }

                couponDetails = {
                    code: validCoupon.code,
                    discount: calculatedTotalCouponDiscount,
                    type: validCoupon.discountType
                };

                // If client didn't handle coupon calculation, do it server-side
                if (!useClientItems) {
                    // Calculate total coupon discount
                    if (validCoupon.discountType === 'PERCENTAGE') {
                        calculatedTotalCouponDiscount = (calculatedSubtotalAfterOffers * validCoupon.discountValue) / 100;
                        if (validCoupon.maxDiscount && calculatedTotalCouponDiscount > validCoupon.maxDiscount) {
                            calculatedTotalCouponDiscount = validCoupon.maxDiscount;
                        }
                    } else {
                        // For fixed amount coupons
                        calculatedTotalCouponDiscount = validCoupon.discountValue;
                    }
                    
                    // Distribute coupon discount across products
                    const totalSubtotalAfterOffers = orderItems.reduce((sum, item) => sum + item.subtotalforproduct, 0);
                    orderItems.forEach(item => {
                        const proportion = item.subtotalforproduct / totalSubtotalAfterOffers;
                        const itemCouponDiscount = calculatedTotalCouponDiscount * proportion;
                        
                        item.couponForProduct = {
                            code: validCoupon.code,
                            discount: itemCouponDiscount,
                            type: validCoupon.discountType
                        };
                        item.couponDiscount = itemCouponDiscount;
                        item.finalPrice = item.priceAfterOffer - (itemCouponDiscount / item.quantity);
                        item.finalAmount = item.finalPrice * item.quantity;
                    });
                }
            }

            // Calculate final amounts
            const subtotalAfterCoupon = calculatedSubtotalAfterOffers - calculatedTotalCouponDiscount;
            const gstAmount = clientGstAmount || Math.round(subtotalAfterCoupon * 0.18);
            const shippingCost = clientShippingCost || Math.round(subtotalAfterCoupon * 0.02);
            const finalAmount = subtotalAfterCoupon + gstAmount + shippingCost;

            console.log('Creating order with values:', {
                finalAmount,
                calculatedOriginalSubtotal,
                calculatedSubtotalAfterOffers,
                calculatedTotalOfferDiscount,
                calculatedTotalCouponDiscount,
                gstAmount,
                shippingCost
            });

            // Create order
            const newOrderId = uuidv4();
            const order = new Order({
                orderId: newOrderId,
                userId,
                items: orderItems,
                totalAmount: finalAmount,
                originalSubtotal: calculatedOriginalSubtotal,
                subtotal: calculatedSubtotalAfterOffers,
                totalOfferDiscount: calculatedTotalOfferDiscount,
                totalCouponDiscount: calculatedTotalCouponDiscount,
                gstAmount,
                shippingCost,
                paymentMethod,
                paymentStatus: 'pending',
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
                expectedDeliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                coupon: couponDetails
            });

            await order.save();
            console.log('Order saved successfully:', order.orderId);

            // Update coupon usage after order is created
            if (coupon && couponDetails) {
                await Coupon.findByIdAndUpdate(
                    coupon.id,
                    {
                        $push: {
                            usageHistory: {
                                userId: userId,
                                orderId: newOrderId,
                                usedAt: new Date()
                            }
                        }
                    }
                );
            }

            if (paymentMethod === 'cod') {
                order.paymentStatus = 'unpaid';
                await order.save();
                await CartItem.deleteMany({ userId });

                return res.json({
                    success: true,
                    message: 'Order placed successfully',
                    orderId: order.orderId,
                    paymentMethod,
                    redirect: `/order/success/${order.orderId}`
                });
            } 
            else if (paymentMethod === 'online') {
                try {
                    console.log('Creating Razorpay order');
                    verifyRazorpayConfig();

                    // Razorpay has a minimum amount requirement of 1 INR (100 paise)
                    const minimumAmount = 100; // 1 INR in paise
                    const orderAmount = Math.max(Math.round(totalAmount * 100), minimumAmount);

                    const options = {
                        amount: orderAmount,
                        currency: "INR",
                        receipt: order.orderId,
                        notes: {
                            orderId: order.orderId,
                            userId: userId.toString()
                        }
                    };

                    console.log('Creating Razorpay order with amount:', orderAmount);
                    const razorpayOrder = await razorpay.orders.create(options);

                    if (!razorpayOrder || !razorpayOrder.id) {
                        throw new Error('Failed to create Razorpay order');
                    }

                    // Update order with Razorpay details
                    order.paymentDetails = {
                        razorpayOrderId: razorpayOrder.id
                    };
                    await order.save();

                    return res.json({
                        success: true,
                        message: 'Order created',
                        orderId: order.orderId,
                        paymentMethod,
                        razorpayOrder: {
                            id: razorpayOrder.id,
                            amount: orderAmount,
                            currency: 'INR'
                        }
                    });
                } catch (razorpayError) {
                    console.error('Razorpay Order Creation Error:', razorpayError);
                    await Order.findByIdAndDelete(order._id);
                    throw new Error(razorpayError.error?.description || razorpayError.message || 'Failed to create payment order');
                }
            }
            else if (paymentMethod === 'wallet') {
                // Check wallet balance
                const wallet = await Wallet.findOne({ userId });
                if (!wallet || wallet.balance < finalAmount) {
                    return res.status(400).json({
                        success: false,
                        message: 'Insufficient wallet balance'
                    });
                }

                // Deduct amount from wallet
                wallet.balance -= finalAmount;
                wallet.transactions.push({
                    transactionId: uuidv4(),
                    type: 'DEBIT',
                    amount: finalAmount,
                    description: `Payment for order ${newOrderId}`,
                    date: new Date()
                });
                await wallet.save();

                // Update order payment status
                order.paymentStatus = 'paid';
                await order.save();

                // Clear cart
                await CartItem.deleteMany({ userId });

                return res.json({
                    success: true,
                    paymentMethod: 'wallet',
                    redirect: `/order/success/${newOrderId}`
                });
            }

        } catch (error) {
            console.error('Create Order Error:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to create order'
            });
        }
    },

    getOrders: async (req, res) => {
        try {
            const userId = req.session.userId;
            const user = await User.findById(userId);

            // Pagination parameters
            const page = parseInt(req.query.page) || 1;
            const limit = 5; // Orders per page
            const skip = (page - 1) * limit;

            // Get total count of orders
            const totalOrders = await Order.countDocuments({ userId });
            const totalPages = Math.ceil(totalOrders / limit);

            // Fetch paginated orders for the user, sorted by date (newest first)
            const orders = await Order.find({ userId })
                .sort({ orderDate: -1 })
                .skip(skip)
                .limit(limit);

            res.render('user/orders', {
                title: 'My Orders',
                user,
                orders,
                currentPage: 'orders',
                totalOrders,
                pagination: {
                    page,
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            });

        } catch (error) {
            console.error('Get Orders Error:', error);
            res.status(500).render('error', {
                message: 'Error loading orders'
            });
        }
    },

    cancelOrderItem: async (req, res) => {
        try {
            const { orderId, itemId } = req.params;
            const userId = req.session.userId;

            const order = await Order.findOne({ orderId, userId });
            if (!order) {
                return res.status(404).json({
                    success: false,
                    message: 'Order not found'
                });
            }

            const item = order.items.id(itemId);
            if (!item) {
                return res.status(404).json({
                    success: false,
                    message: 'Item not found'
                });
            }

            if (!['pending', 'processing'].includes(item.status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Item cannot be cancelled at this stage'
                });
            }

            // Update product stock
            const product = await Product.findById(item.productId);
            if (!product) {
                return res.status(404).json({
                    success: false,
                    message: 'Product not found'
                });
            }

            const variant = product.variants.find(v => v.type === item.variantType);
            if (!variant) {
                return res.status(404).json({
                    success: false,
                    message: 'Product variant not found'
                });
            }

            // Increase stock
            variant.stock += item.quantity;
            await product.save();
            console.log(`Stock updated for ${product.name} (${item.variantType}): +${item.quantity}, New stock: ${variant.stock}`);

            // Calculate refund amount
            let refundAmount = 0;
            
            // Modern order item structure
            if (item.finalAmount && !isNaN(item.finalAmount)) {
                // Start with the item's final amount which includes all discounts
                refundAmount = parseFloat(item.finalAmount);
                
                // Add GST for this item
                if (item.gstAmount && !isNaN(item.gstAmount)) {
                    refundAmount += parseFloat(item.gstAmount);
                }
                
                // Add shipping cost for this item
                if (item.shippingCost && !isNaN(item.shippingCost)) {
                    refundAmount += parseFloat(item.shippingCost);
                }
            } else {
                // Older order item structure
                const itemPrice = parseFloat(item.price) || 0;
                const itemDiscount = parseFloat(item.discount) || 0;
                const itemQuantity = parseInt(item.quantity) || 1;
                
                const discountAmount = (itemPrice * itemDiscount) / 100;
                const priceAfterDiscount = itemPrice - discountAmount;
                const itemBasePrice = priceAfterDiscount * itemQuantity;
                
                refundAmount = itemBasePrice;
                
                // Calculate proportional GST and shipping
                const orderSubtotal = parseFloat(order.subtotal) || 0;
                if (orderSubtotal > 0) {
                    const itemProportion = itemBasePrice / orderSubtotal;
                    const gstAmount = parseFloat(order.gstAmount) || 0;
                    const shippingCost = parseFloat(order.shippingCost) || 0;
                    
                    refundAmount += (gstAmount + shippingCost) * itemProportion;
                }
            }
            
            // Ensure the refund amount is valid
            refundAmount = Math.max(parseFloat(refundAmount) || 0, 0);
            
            console.log(`Calculated refund for cancelled item: ${item.name}, Amount: ${refundAmount}`);

            // Process refund based on payment method
            if (order.paymentMethod === 'wallet' || order.paymentMethod === 'online') {
                // Find or create user's wallet
                let wallet = await Wallet.findOne({ userId });
                if (!wallet) {
                    wallet = new Wallet({
                        userId,
                        balance: 0,
                        transactions: []
                    });
                }

                // Add refund to wallet
                wallet.balance += refundAmount;
                wallet.transactions.push({
                    transactionId: uuidv4(),
                    type: 'CREDIT',
                    amount: refundAmount,
                    description: `Refund for cancelled order ${order.orderId} (${item.name})`,
                    date: new Date()
                });

                await wallet.save();
                console.log(`Wallet refund processed: ₹${refundAmount} for order ${order.orderId}`);
            }

            // Update order status
            item.status = 'cancelled';
            item.cancelledDate = new Date();
            await order.save();

            res.json({
                success: true,
                message: 'Item cancelled successfully'
            });

        } catch (error) {
            console.error('Cancel Order Item Error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to cancel item'
            });
        }
    },

    requestReturn: async (req, res) => {
        try {
            const { orderId, itemId } = req.params;
            const { reason } = req.body;
            const userId = req.session.userId;

            const order = await Order.findOne({ 
                orderId: orderId,
                userId: userId
            });

            if (!order) {
                return res.status(404).json({
                    success: false,
                    message: 'Order not found'
                });
            }

            const item = order.items.id(itemId);
            if (!item) {
                return res.status(404).json({
                    success: false,
                    message: 'Item not found'
                });
            }

            if (item.status !== 'delivered') {
                return res.status(400).json({
                    success: false,
                    message: 'Return can only be requested for delivered items'
                });
            }

            // Check if return is requested within 7 days of delivery
            const deliveryDate = new Date(item.deliveredDate);
            const today = new Date();
            const daysSinceDelivery = Math.floor((today - deliveryDate) / (1000 * 60 * 60 * 24));

            if (daysSinceDelivery > 7) {
                return res.status(400).json({
                    success: false,
                    message: 'Return can only be requested within 7 days of delivery'
                });
            }

            item.status = 'return requested';
            item.return = {
                reason: reason,
                requestedAt: new Date()
            };
            await order.save();

            res.json({
                success: true,
                message: 'Return requested successfully'
            });

        } catch (error) {
            console.error('Request Return Error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to request return'
            });
        }
    },

    getOrderSuccess: async (req, res) => {
        try {
            const { orderId } = req.params;
            const userId = req.session.userId;

            const order = await Order.findOne({ orderId, userId });
            if (!order) {
                return res.redirect('/orders');
            }

            res.render('user/orderSuccess', {
                title: 'Order Success',
                orderId: order.orderId,
                totalAmount: order.totalAmount,
                paymentMethod: order.paymentMethod,
                paymentStatus: order.paymentStatus,
                expectedDeliveryDate: order.expectedDeliveryDate,
                currentPage: 'orders'
            });

        } catch (error) {
            console.error('Order Success Error:', error);
            res.redirect('/orders');
        }
    },

    generateInvoice: async (req, res) => {
        try {
            const { orderId, itemId } = req.params;
            const userId = req.session.userId;

            // Fetch the order
            const order = await Order.findOne({ 
                orderId: orderId,
                userId: userId
            });

            if (!order) {
                return res.status(404).send('Order not found');
            }

            // Find the specific item in the order
            const item = order.items.id(itemId);
            if (!item) {
                return res.status(404).send('Item not found');
            }

            // Check if the item status allows for invoice generation
            const allowedStatuses = ['delivered', 'return requested', 'return rejected', 'returned'];
            if (!allowedStatuses.includes(item.status)) {
                return res.status(403).send('Invoice is only available for delivered or returned items');
            }

            // Get user details
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).send('User not found');
            }

            // Create a shortened version of the order ID
            const shortenedOrderId = orderId.substring(0, 6);

            // Create a PDF document
            const doc = new PDFDocument({ margin: 50 });
            
            // Set response headers for PDF download
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=invoice-${shortenedOrderId}-${itemId}.pdf`);
            
            // Pipe the PDF to the response
            doc.pipe(res);
            
            // Define document width for easier alignment
            const pageWidth = doc.page.width - 100; // Accounting for margins
            
            // Add company logo or name
            doc.fontSize(22).text('Your E-Commerce Store', { align: 'center' });
            doc.moveDown(0.5);
            doc.fontSize(16).text('Tax Invoice / Receipt', { align: 'center' });
            doc.moveDown(1.5);
            
            // Add a horizontal line
            doc.moveTo(50, doc.y)
               .lineTo(doc.page.width - 50, doc.y)
               .stroke();
            doc.moveDown(1);
            
            // Order details section with better alignment
            doc.font('Helvetica-Bold').fontSize(14).text('Order Details', { continued: false });
            doc.moveDown(0.5);
            
            // Create a grid layout for order details
            const leftColumnX = 50;
            const rightColumnX = 300;
            let currentY = doc.y;
            
            doc.font('Helvetica').fontSize(10);
            
            // Left column of order details
            doc.text('Invoice Date:', leftColumnX, currentY);
            doc.text(`${new Date().toLocaleDateString()}`, leftColumnX + 100, currentY);
            
            currentY += 20;
            doc.text('Order ID:', leftColumnX, currentY);
            doc.text(`${shortenedOrderId}`, leftColumnX + 100, currentY);
            
            currentY += 20;
            doc.text('Order Date:', leftColumnX, currentY);
            doc.text(`${new Date(order.orderDate).toLocaleDateString()}`, leftColumnX + 100, currentY);
            
            // Reset Y position for right column
            currentY = doc.y - 40;
            
            // Right column of order details
            doc.text('Payment Method:', rightColumnX, currentY);
            doc.text(`${order.paymentMethod.toUpperCase()}`, rightColumnX + 100, currentY);
            
            currentY += 20;
            doc.text('Payment Status:', rightColumnX, currentY);
            doc.text(`${order.paymentStatus.toUpperCase()}`, rightColumnX + 100, currentY);
            
            // Move to next section - Customer & Shipping Details
            doc.moveDown(2);
            
            // Two column layout for customer and shipping details
            doc.font('Helvetica-Bold').fontSize(14).text('Customer Details', leftColumnX);
            doc.moveDown(0.5);
            
            const customerY = doc.y;
            
            doc.font('Helvetica').fontSize(10);
            doc.text(`Name: ${user.firstName} ${user.lastName || ''}`, leftColumnX, customerY);
            doc.text(`Email: ${user.email}`, leftColumnX, customerY + 15);
            doc.text(`Phone: ${user.phone || 'N/A'}`, leftColumnX, customerY + 30);
            
            // Fix shipping address alignment - explicitly position it
            const shippingX = 300; // Right column position
            doc.font('Helvetica-Bold').fontSize(14).text('Shipping Address', shippingX, customerY - 20);
            
            // Reset font for shipping details
            doc.font('Helvetica').fontSize(10);
            doc.text(`${order.shippingAddress.name}`, shippingX, customerY);
            doc.text(`${order.shippingAddress.houseName}, ${order.shippingAddress.localityStreet}`, shippingX, customerY + 15);
            doc.text(`${order.shippingAddress.city}, ${order.shippingAddress.state} - ${order.shippingAddress.pincode}`, shippingX, customerY + 30);
            doc.text(`Phone: ${order.shippingAddress.phone}`, shippingX, customerY + 45);
            
            if (order.shippingAddress.alternatePhone) {
                doc.text(`Alt Phone: ${order.shippingAddress.alternatePhone}`, shippingX, customerY + 60);
            }
            
            // Make sure we move past both columns
            doc.y = Math.max(doc.y, customerY + 75);
            
            // Product details
            doc.moveDown(2);
            doc.font('Helvetica-Bold').fontSize(14).text('Product Details');
            doc.moveDown(0.5);
            
            // Table header
            const colPositions = {
                item: 50,
                variant: 250,
                qty: 350,
                price: 410,
                total: 470
            };
            
            doc.font('Helvetica-Bold').fontSize(10);
            doc.text('Item', colPositions.item);
            doc.text('Variant', colPositions.variant, doc.y - 12);
            doc.text('Qty', colPositions.qty, doc.y - 12);
            doc.text('Price', colPositions.price, doc.y - 12);
            doc.text('Total', colPositions.total, doc.y - 12);
            
            doc.moveDown(0.5);
            
            // Horizontal line
            doc.moveTo(50, doc.y)
               .lineTo(doc.page.width - 50, doc.y)
               .stroke();
            doc.moveDown(0.5);
            
            // Item details
            doc.font('Helvetica').fontSize(10);
            
            // Calculate prices - handle both new and old model structures
            let originalPrice, discountedPrice, totalPrice;
            let hasOffer = false;  // Track if there's an offer applied
            
            if (item.originalPrice !== undefined) {
                // New model structure
                originalPrice = parseFloat(item.originalPrice) || 0;
                
                if (item.finalPrice !== undefined) {
                    discountedPrice = parseFloat(item.finalPrice) || originalPrice;
                    totalPrice = parseFloat(item.finalAmount) || (discountedPrice * item.quantity);
                    hasOffer = item.offerDiscount > 0 || item.couponDiscount > 0;
                } else if (item.priceAfterOffer !== undefined) {
                    discountedPrice = parseFloat(item.priceAfterOffer) || originalPrice;
                    totalPrice = discountedPrice * item.quantity;
                    hasOffer = originalPrice !== discountedPrice || (item.offer && item.offer.discount > 0);
                } else {
                    discountedPrice = originalPrice;
                    totalPrice = originalPrice * item.quantity;
                }
            } else {
                // Old model structure
                originalPrice = parseFloat(item.price) || 0;
                const discount = parseFloat(item.discount) || 0;
                const discountAmount = originalPrice * (discount / 100);
                discountedPrice = originalPrice - discountAmount;
                totalPrice = discountedPrice * item.quantity;
                hasOffer = discount > 0;
            }
            
            doc.text(item.name, colPositions.item);
            doc.text(item.variantType || 'Standard', colPositions.variant, doc.y - 12);
            doc.text(item.quantity.toString(), colPositions.qty, doc.y - 12);
            doc.text(`₹${discountedPrice.toFixed(2)}`, colPositions.price, doc.y - 12);
            doc.text(`₹${totalPrice.toFixed(2)}`, colPositions.total, doc.y - 12);
            
            // Determine if there's a discount to show, using a more reliable approach
            // Use a small epsilon value (0.01) to account for floating-point comparison issues
            const EPSILON = 0.01;
            const priceDifference = Math.abs(originalPrice - discountedPrice);
            const hasDiscount = hasOffer || 
                                priceDifference > EPSILON || 
                                (item.discount !== undefined && item.discount > 0) ||
                                (item.offerDiscount !== undefined && item.offerDiscount > 0) ||
                                (item.couponDiscount !== undefined && item.couponDiscount > 0);
            
            if (hasDiscount) {
                doc.moveDown(0.5);
                doc.text(`Original Price: ₹${originalPrice.toFixed(2)}`, colPositions.item);
                
                // Show the right discount message based on available fields
                let discountText = '';
                if (item.offer && item.offer.discount) {
                    discountText = `${item.offer.discount}% off (₹${(originalPrice * item.offer.discount / 100).toFixed(2)})`;
                } else if (item.discount !== undefined && item.discount > 0) {
                    discountText = `${item.discount}% off (₹${(originalPrice * item.discount / 100).toFixed(2)})`;
                } else if (item.offerDiscount !== undefined && item.offerDiscount > 0) {
                    discountText = `Discount: ₹${item.offerDiscount.toFixed(2)}`;
                } else {
                    const discountAmount = originalPrice - discountedPrice;
                    discountText = `Discount: ₹${discountAmount.toFixed(2)}`;
                }
                
                doc.text(discountText, colPositions.variant, doc.y - 12);
            }
            
            // If there's a coupon discount, show it - ensure it's actually greater than zero
            if (item.couponDiscount !== undefined && parseFloat(item.couponDiscount) > 0) {
                doc.moveDown(0.5);
                doc.text(`Coupon Discount: ₹${parseFloat(item.couponDiscount).toFixed(2)}`, colPositions.item);
                if (item.couponForProduct && item.couponForProduct.code) {
                    doc.text(`Coupon: ${item.couponForProduct.code}`, colPositions.variant, doc.y - 12);
                }
            }
            
            doc.moveDown(2);
            
            // Total section with proper alignment
            doc.moveTo(50, doc.y)
               .lineTo(doc.page.width - 50, doc.y)
               .stroke();
            doc.moveDown(1);
            
            // Set up explicit positions for better alignment
            const totalLabelX = doc.page.width - 300; // Label column
            const totalValueX = doc.page.width - 150;  // Value column
            
            // Ensure proper alignment of totals
            doc.font('Helvetica-Bold').fontSize(10);
            
            const subtotalY = doc.y;
            doc.text('Subtotal:', totalLabelX, subtotalY, { align: 'left' });
            doc.text(`₹${totalPrice.toFixed(2)}`, totalValueX, subtotalY, { align: 'right' });
            
            const shippingY = subtotalY + 20;
            doc.text('Shipping:', totalLabelX, shippingY, { align: 'left' });
            const shipping = 40; // Fixed value for simplicity
            doc.text(`₹${shipping.toFixed(2)}`, totalValueX, shippingY, { align: 'right' });
            
            // Total with background highlight
            const grandTotalY = shippingY + 25;
            doc.rect(totalLabelX - 10, grandTotalY - 5, 180, 25).fill('#f0f0f0');
            doc.fill('black');
            
            doc.fontSize(12);
            doc.text('Grand Total:', totalLabelX, grandTotalY, { align: 'left' });
            doc.text(`₹${(totalPrice + shipping).toFixed(2)}`, totalValueX, grandTotalY, { align: 'right' });
            
            // Continue with the rest of the invoice
            doc.y = grandTotalY + 25;
            
            // Add delivery details
            doc.moveDown(2);
            doc.fontSize(10).font('Helvetica-Bold');
            doc.text('Delivery Information', 50, doc.y);
            doc.moveDown(0.5);
            
            doc.font('Helvetica');
            if (item.status === 'delivered') {
                doc.text(`Delivered on: ${new Date(item.deliveredDate).toLocaleDateString()}`);
            } else if (item.status === 'returned') {
                doc.text(`Delivered on: ${new Date(item.deliveredDate).toLocaleDateString()}`);
                doc.moveDown(0.5);
                doc.text(`Returned on: ${new Date(item.returnedDate).toLocaleDateString()}`);
            } else if (item.status === 'return requested') {
                doc.text(`Delivered on: ${new Date(item.deliveredDate).toLocaleDateString()}`);
                doc.moveDown(0.5);
                doc.text(`Return requested on: ${new Date(item.return.requestedAt).toLocaleDateString()}`);
                doc.moveDown(0.5);
                doc.text(`Return reason: ${item.return.reason}`);
            }
            
            // Add terms and conditions
            doc.moveDown(2);
            doc.font('Helvetica-Bold').text('Terms & Conditions');
            doc.moveDown(0.5);
            doc.font('Helvetica').fontSize(9);
            doc.text('1. Returns accepted within 7 days of delivery.');
            doc.moveDown(0.3);
            doc.text('2. Please retain this invoice for warranty purposes.');
            doc.moveDown(0.3);
            doc.text('3. For any issues, please contact customer support.');
            
            // Footer with page numbers
            const pageNumber = 1; // For single page invoices
            doc.fontSize(10).text(
                `Page ${pageNumber} of ${pageNumber}`,
                50,
                doc.page.height - 50,
                { align: 'center' }
            );
            
            // // Final footer line
            // doc.moveUp();
            // doc.fontSize(10).text('Thank you for shopping with us!', {
            //     align: 'center'
            // });
            
            // Finalize the PDF
            doc.end();
            
        } catch (error) {
            console.error('Generate Invoice Error:', error);
            res.status(500).send('Error generating invoice');
        }
    },

    applyCoupon: async (req, res) => {
        try {
            const userId = req.session.userId;
            const { couponId, subtotal, items } = req.body;

            // Validate coupon
            const coupon = await Coupon.findOne({
                _id: couponId,
                isActive: true,
                startDate: { $lte: new Date() },
                expiryDate: { $gte: new Date() },
                minPurchase: { $lte: subtotal }
            });

            if (!coupon) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid or expired coupon'
                });
            }

            // Check usage limit
            const userUsage = coupon.usageHistory.filter(
                history => history.userId.toString() === userId.toString()
            ).length;

            if (userUsage >= coupon.usageLimit) {
                return res.status(400).json({
                    success: false,
                    message: 'Coupon usage limit reached'
                });
            }

            // Calculate discount
            let discount = 0;
            if (coupon.discountType === 'PERCENTAGE') {
                discount = (subtotal * coupon.discountValue) / 100;
                if (coupon.maxDiscount) {
                    discount = Math.min(discount, coupon.maxDiscount);
                }
            } else {
                discount = coupon.discountValue;
            }

            res.json({
                success: true,
                discount,
                message: 'Coupon applied successfully'
            });

        } catch (error) {
            console.error('Apply Coupon Error:', error);
            res.status(500).json({
                success: false,
                message: 'Error applying coupon'
            });
        }
    },

    updateProductStock: async (order) => {
        try {
            for (const item of order.items) {
                const product = await Product.findById(item.productId);
                if (!product) continue;

                const variant = product.variants.find(v => v.type === item.variantType);
                if (!variant) continue;

                // Decrease stock
                variant.stock -= item.quantity;
                await product.save();
            }
        } catch (error) {
            console.error('Error updating product stock:', error);
            throw error;
        }
    },

    verifyPayment: async (req, res) => {
        try {
            const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
            
            // Create signature verification data
            const sign = razorpay_order_id + "|" + razorpay_payment_id;
            const expectedSignature = crypto
                .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET.trim())
                .update(sign)
                .digest("hex");

            // Verify signature
            if (expectedSignature === razorpay_signature) {
                const order = await Order.findOne({
                    'paymentDetails.razorpayOrderId': razorpay_order_id
                });

                if (!order) {
                    throw new Error('Order not found');
                }

                // Update order status
                order.paymentStatus = 'paid';
                order.paymentDetails = {
                    ...order.paymentDetails,
                    razorpayPaymentId: razorpay_payment_id,
                    razorpaySignature: razorpay_signature
                };
                await order.save();

                // Not needed to call updateProductStock since stock is already updated at order creation
                // Just clear cart after successful payment
                await CartItem.deleteMany({ userId: order.userId });

                return res.json({
                    success: true,
                    message: 'Payment verified successfully',
                    redirect: `/order/success/${order.orderId}`
                });
            }

            throw new Error('Payment verification failed');

        } catch (error) {
            console.error('Payment Verification Error:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Payment verification failed'
            });
        }
    }
};

export default orderController;

