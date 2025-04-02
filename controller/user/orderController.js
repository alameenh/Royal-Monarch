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

            let subtotal = 0;
            let totalOfferDiscount = 0;

            // Process each cart item with offers
            const processedItems = await Promise.all(cartItems.map(async item => {
                if (!item.productId || item.productId.status !== 'Active') return null;

                // Get variant details
                const variant = item.productId.variants.find(v => v.type === item.variantType);
                const originalPrice = variant.price;
                const itemSubtotal = originalPrice * item.quantity;

                // Find applicable product offer
                const productOffer = activeOffers.find(offer => 
                    offer.type === 'product' && 
                    offer.productIds.some(id => id.toString() === item.productId._id.toString())
                );

                // Find applicable category offer
                const categoryOffer = activeOffers.find(offer => 
                    offer.type === 'category' && 
                    offer.categoryId.toString() === item.productId.category.toString()
                );

                // Apply best offer (product offer takes priority)
                const applicableOffer = productOffer || categoryOffer;
                let discountedPrice = originalPrice;
                let offerDiscount = 0;

                if (applicableOffer) {
                    offerDiscount = (originalPrice * applicableOffer.discount) / 100;
                    discountedPrice = originalPrice - offerDiscount;
                    totalOfferDiscount += offerDiscount * item.quantity;
                }

                subtotal += itemSubtotal;

                return {
                    ...item,
                    originalPrice,
                    discountedPrice,
                    quantity: item.quantity,
                    itemSubtotal,
                    totalPrice: discountedPrice * item.quantity,
                    offer: applicableOffer ? {
                        name: applicableOffer.name,
                        discount: applicableOffer.discount,
                        type: applicableOffer.type
                    } : null
                };
            }));

            // Calculate GST and final total
            const subtotalAfterOffers = subtotal - totalOfferDiscount;
            const gstAmount = subtotalAfterOffers * 0.10; // 10% GST
            const shippingCost = 40;
            const total = subtotalAfterOffers + gstAmount + shippingCost;

            // Fetch valid coupons
            const validCoupons = await Coupon.find({
                isActive: true,
                startDate: { $lte: new Date() },
                expiryDate: { $gte: new Date() },
                minPurchase: { $lte: subtotalAfterOffers }
            }).lean();

            // Filter eligible coupons
            const eligibleCoupons = validCoupons.filter(coupon => {
                const userUsage = coupon.usageHistory.filter(
                    history => history.userId.toString() === userId.toString()
                ).length;
                return userUsage < coupon.usageLimit;
            });

            res.render('user/checkout', {
                user,
                addresses,
                cartItems: processedItems.filter(item => item !== null),
                subtotal,
                totalOfferDiscount,
                subtotalAfterOffers,
                gstAmount,
                shippingCost,
                total,
                coupons: eligibleCoupons,
                currentPage: 'checkout',
                razorpayKey: process.env.RAZORPAY_KEY_ID
            });

        } catch (error) {
            console.error('Checkout Error:', error);
            res.status(500).render('error', { message: 'Error loading checkout page' });
        }
    },

    createOrder: async (req, res) => {
        try {
            const userId = req.session.userId;
            const { addressId, paymentMethod, coupon } = req.body;

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

            // Calculate totals and prepare order items
            let subtotal = 0;
            let totalOfferDiscount = 0;
            const orderItems = [];

            for (const item of cartItems) {
                if (!item.productId || item.productId.status !== 'Active') continue;

                const variant = item.productId.variants.find(v => v.type === item.variantType);
                const originalPrice = variant.price;
                const itemSubtotal = originalPrice * item.quantity;
                
                // Apply offer discount if any
                let discountedPrice = item.discountedPrice || originalPrice;
                let offerDiscount = originalPrice - discountedPrice;

                subtotal += itemSubtotal;
                totalOfferDiscount += offerDiscount * item.quantity;

                orderItems.push({
                    name: item.productId.name,
                    brand: item.productId.brand,
                    images: item.productId.images,
                    quantity: item.quantity,
                    price: originalPrice,
                    discount: offerDiscount,
                    variantType: item.variantType
                });
            }

            // Apply coupon if provided
            let couponDiscount = 0;
            if (coupon) {
                couponDiscount = coupon.discount;
            }

            // Calculate final amounts
            const subtotalAfterOffers = subtotal - totalOfferDiscount;
            const gstAmount = (subtotalAfterOffers - couponDiscount) * 0.10; // 10% GST
            const shippingCost = 40;
            const totalAmount = subtotalAfterOffers - couponDiscount + gstAmount + shippingCost;

            // Create new order with initial payment status
            const order = new Order({
                orderId: uuidv4(),
                userId,
                items: orderItems,
                totalAmount,
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
                coupon: coupon ? {
                    code: coupon.code,
                    discount: couponDiscount
                } : undefined
            });

            await order.save();

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
                    // Verify Razorpay configuration
                    verifyRazorpayConfig();

                    const options = {
                        amount: Math.round(totalAmount * 100),
                        currency: "INR",
                        receipt: order.orderId,
                        notes: {
                            orderId: order.orderId,
                            userId: userId.toString()
                        }
                    };

                    console.log('Creating Razorpay order with options:', {
                        ...options,
                        amount: options.amount / 100 // Log actual amount in rupees
                    });

                    const razorpayOrder = await razorpay.orders.create(options);

                    if (!razorpayOrder || !razorpayOrder.id) {
                        throw new Error('Failed to create Razorpay order');
                    }

                    console.log('Razorpay order created:', {
                        id: razorpayOrder.id,
                        amount: razorpayOrder.amount / 100
                    });

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
                            amount: razorpayOrder.amount,
                            currency: razorpayOrder.currency
                        }
                    });
                } catch (razorpayError) {
                    console.error('Razorpay Order Creation Error:', razorpayError);
                    await Order.findByIdAndDelete(order._id);
                    throw new Error(razorpayError.error?.description || razorpayError.message || 'Failed to create payment order');
                }
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

            if (!['pending', 'processing'].includes(item.status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Item cannot be cancelled at this stage'
                });
            }

            // Find the product to update stock
            const product = await Product.findOne({
                name: item.name,
                'variants.type': item.variant
            });

            if (product) {
                // Find the variant and update its stock
                const variantIndex = product.variants.findIndex(v => v.type === item.variant);
                if (variantIndex !== -1) {
                    // Add the cancelled quantity back to stock
                    product.variants[variantIndex].stock += item.quantity;
                    await product.save();
                }
            }

            // Update order item status
            item.status = 'cancelled';
            item.cancelledDate = new Date();
            await order.save();

            res.json({
                success: true,
                message: 'Item cancelled successfully and stock updated'
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

            // Create a PDF document
            const doc = new PDFDocument({ margin: 50 });
            
            // Set response headers for PDF download
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=invoice-${orderId}-${itemId}.pdf`);
            
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
            doc.text(`${order.orderId}`, leftColumnX + 100, currentY);
            
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
            
            // Calculate prices
            const originalPrice = item.price;
            const discountAmount = originalPrice * (item.discount / 100);
            const discountedPrice = originalPrice - discountAmount;
            const totalPrice = discountedPrice * item.quantity;
            
            doc.text(item.name, colPositions.item);
            doc.text(item.variant, colPositions.variant, doc.y - 12);
            doc.text(item.quantity.toString(), colPositions.qty, doc.y - 12);
            doc.text(`₹${discountedPrice.toFixed(2)}`, colPositions.price, doc.y - 12);
            doc.text(`₹${totalPrice.toFixed(2)}`, colPositions.total, doc.y - 12);
            
            // If there's a discount, show it
            if (item.discount > 0) {
                doc.moveDown(0.5);
                doc.text(`Original Price: ₹${originalPrice.toFixed(2)}`, colPositions.item);
                doc.text(`Discount: ${item.discount}% (₹${discountAmount.toFixed(2)})`, colPositions.variant, doc.y - 12);
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

                // Clear cart
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
