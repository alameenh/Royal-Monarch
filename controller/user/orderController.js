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
import mongoose from 'mongoose';

// Initialize Razorpay with proper error handling
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Simple Razorpay configuration check
const verifyRazorpayConfig = async () => {
    console.log('Verifying Razorpay configuration...');
    console.log('RAZORPAY_KEY_ID:', process.env.RAZORPAY_KEY_ID);
    console.log('RAZORPAY_KEY_SECRET exists:', !!process.env.RAZORPAY_KEY_SECRET);
    
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        throw new Error('Razorpay credentials not configured');
    }
    
    // Basic validation of credentials format
    if (!process.env.RAZORPAY_KEY_ID.startsWith('rzp_')) {
        throw new Error('Invalid Razorpay key ID format');
    }
    
    return true;
};

const orderController = {
    getOrders: async (req, res) => {
        try {
            const userId = req.session.userId;
            if (!userId) {
                return res.redirect('/login');
            }

            const user = await User.findById(userId);
            if (!user) {
                return res.redirect('/login');
            }

            // Search and filter parameters
            const searchTerm = req.query.searchTerm || '';
            const minPrice = req.query.minPrice ? parseFloat(req.query.minPrice) : null;
            const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice) : null;
            const sortBy = req.query.sortBy || 'orderDate';
            const order = req.query.order || 'desc';

            // Pagination parameters
            const page = parseInt(req.query.page) || 1;
            const limit = 5; // Orders per page
            const skip = (page - 1) * limit;

            // Build query
            let query = { userId };

            // Add search conditions
            if (searchTerm) {
                query.$or = [
                    { orderId: { $regex: searchTerm, $options: 'i' } },
                    { 'items.name': { $regex: searchTerm, $options: 'i' } }
                ];
            }

            // Add price range conditions
            if (minPrice !== null || maxPrice !== null) {
                query.totalAmount = {};
                if (minPrice !== null) query.totalAmount.$gte = minPrice;
                if (maxPrice !== null) query.totalAmount.$lte = maxPrice;
            }

            // Get total count of orders
            const totalOrders = await Order.countDocuments(query);
            const totalPages = Math.ceil(totalOrders / limit);

            // Sort options
            const sortOptions = {
                'orderDate': { orderDate: order === 'desc' ? -1 : 1 },
                'totalAmount': { totalAmount: order === 'desc' ? -1 : 1 }
            };

            // Fetch paginated orders for the user
            const orders = await Order.find(query)
                .sort(sortOptions[sortBy] || { orderDate: -1 })
                .skip(skip)
                .limit(limit)
                .populate('items.productId', 'name images variants brand status category');

            // Check if it's an AJAX request
            if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                return res.json({
                    success: true,
                    orders,
                    pagination: {
                        currentPage: page,
                        totalPages,
                        totalOrders,
                        hasNextPage: page < totalPages,
                        hasPrevPage: page > 1
                    },
                    filters: {
                        searchTerm,
                        minPrice: minPrice?.toString() || '',
                        maxPrice: maxPrice?.toString() || '',
                        sortBy,
                        order
                    }
                });
            }

            res.render('user/orders', {
                title: 'My Orders',
                user,
                orders,
                currentPage: 'orders',
                totalOrders,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalOrders,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1
                },
                filters: {
                    searchTerm,
                    minPrice: minPrice?.toString() || '',
                    maxPrice: maxPrice?.toString() || '',
                    sortBy,
                    order
                }
            });

        } catch (error) {
            console.error('Get Orders Error:', error);
            if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                return res.status(500).json({
                    success: false,
                    message: 'Error loading orders'
                });
            }
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
            if (product) {
            const variant = product.variants.find(v => v.type === item.variantType);
                if (variant) {
            variant.stock += item.quantity;
            await product.save();
                }
            }

            // Calculate refund amount
            let refundAmount = item.finalAmount;

            // Process refund if payment was made
            if (order.paymentMethod === 'wallet' || order.paymentMethod === 'online') {
                let wallet = await Wallet.findOne({ userId });
                if (!wallet) {
                    wallet = new Wallet({
                        userId,
                        balance: 0,
                        transactions: []
                    });
                }

                wallet.balance += refundAmount;
                wallet.transactions.push({
                    transactionId: uuidv4(),
                    type: 'CREDIT',
                    amount: refundAmount,
                    description: `Refund for cancelled item in order ${order.orderId} (${item.name})`,
                    date: new Date()
                });

                await wallet.save();
            }

            // Update item status
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

    searchOrders: async (req, res) => {
        try {
            

            const userId = req.session.userId;
            if (!userId) {
                console.error('No userId found in session');
                return res.status(401).json({
                    success: false,
                    message: 'User not authenticated'
                });
            }

            const { 
                searchTerm = '', 
                page = 1, 
                limit = 5,
                sortBy = 'orderDate',
                order = 'desc'
            } = req.query;
            
            // Build the search query
            let query = { userId };
            
            // Add search term conditions
            if (searchTerm) {
                query.$or = [
                    { orderId: { $regex: searchTerm, $options: 'i' } },
                    { 'items.name': { $regex: searchTerm, $options: 'i' } }
                ];
            }
            
            console.log('MongoDB Query:', JSON.stringify(query, null, 2));
            
            // Get total count for pagination
            const totalOrders = await Order.countDocuments(query);
            const totalPages = Math.ceil(totalOrders / limit);
            
            // Sort options
            const sortOptions = {
                'orderDate': { orderDate: order === 'desc' ? -1 : 1 },
                'totalAmount': { totalAmount: order === 'desc' ? -1 : 1 }
            };
            
            console.log('Fetching orders with sort:', sortOptions[sortBy] || { orderDate: -1 });

            // Fetch orders with search criteria and populate product details
            const orders = await Order.find(query)
                .sort(sortOptions[sortBy] || { orderDate: -1 })
                .skip((parseInt(page) - 1) * limit)
                .limit(parseInt(limit))
                .populate({
                    path: 'items.productId',
                    select: 'name images variants brand status category'
                })
                .lean();

            console.log(`Found ${orders.length} orders`);

            // Format orders for frontend
            const formattedOrders = orders.map(order => {
                try {
                    return {
                        ...order,
                        items: order.items.map(item => ({
                            ...item,
                            productId: item.productId ? {
                                _id: item.productId._id,
                                name: item.productId.name,
                                images: item.productId.images || [], // Ensure images array exists
                                variants: item.productId.variants,
                                brand: item.productId.brand,
                                status: item.productId.status,
                                category: item.productId.category
                            } : null
                        }))
                    };
                } catch (error) {
                    console.error('Error formatting order:', error);
                    return null;
                }
            }).filter(Boolean);

            console.log('Formatted orders:', formattedOrders.length);

            // Check if it's an AJAX request
            if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                return res.json({
                    success: true,
                    orders: formattedOrders,
                    pagination: {
                        currentPage: parseInt(page),
                        totalPages,
                        totalOrders,
                        hasNextPage: parseInt(page) < totalPages,
                        hasPrevPage: parseInt(page) > 1
                    },
                    filters: {
                        searchTerm,
                        sortBy,
                        order
                    }
                });
            }

            res.render('user/orders', {
                title: 'My Orders',
                orders: formattedOrders,
                currentPage: 'orders',
                totalOrders,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages,
                    totalOrders,
                    hasNextPage: parseInt(page) < totalPages,
                    hasPrevPage: parseInt(page) > 1
                },
                filters: {
                    searchTerm,
                    sortBy,
                    order
                }
            });
        } catch (error) {
            console.error('Search Orders Error:', error);
            console.error('Error stack:', error.stack);
            
            if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                return res.status(500).json({
                    success: false,
                    message: 'Error searching orders',
                    error: process.env.NODE_ENV === 'development' ? error.message : undefined
                });
            }
            res.status(500).render('error', {
                message: 'Error searching orders'
            });
        }
    },

    cancelOrder: async (req, res) => {
        try {
            const { orderId } = req.params;
            const userId = req.session.userId;

            const order = await Order.findOne({ orderId, userId });
            if (!order) {
                return res.status(404).json({
                    success: false,
                    message: 'Order not found'
                });
            }

            // Check if any items can be cancelled
            const cancellableItems = order.items.filter(item => 
                ['pending', 'processing'].includes(item.status)
            );

            if (cancellableItems.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No items can be cancelled at this stage'
                });
            }

            // Process each cancellable item
            for (const item of cancellableItems) {
                // Update product stock
                const product = await Product.findById(item.productId);
                if (product) {
                    const variant = product.variants.find(v => v.type === item.variantType);
                    if (variant) {
                        variant.stock += item.quantity;
                        await product.save();
                    }
                }

                // Calculate refund amount
                let refundAmount = item.finalAmount;

                // Process refund if payment was made
                if (order.paymentMethod === 'wallet' || order.paymentMethod === 'online') {
                    let wallet = await Wallet.findOne({ userId });
                    if (!wallet) {
                        wallet = new Wallet({
                            userId,
                            balance: 0,
                            transactions: []
                        });
                    }

                    wallet.balance += refundAmount;
                    wallet.transactions.push({
                        transactionId: uuidv4(),
                        type: 'CREDIT',
                        amount: refundAmount,
                        description: `Refund for cancelled order ${order.orderId} (${item.name})`,
                        date: new Date()
                    });

                    await wallet.save();
                }

                // Update item status
                item.status = 'cancelled';
                item.cancelledDate = new Date();
            }

            await order.save();

            res.json({
                success: true,
                message: 'Order cancelled successfully'
            });

        } catch (error) {
            console.error('Cancel Order Error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to cancel order'
            });
        }
    },

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

            // Fetch active coupons
            const currentDate = new Date();
            console.log('Current system date:', currentDate);
            
            // First, let's check all coupons in the database
            const allCoupons = await Coupon.find({}).lean();
            console.log('All coupons in database:', allCoupons);

            // Now fetch active coupons with a simpler query
            const activeCoupons = await Coupon.find({
                isActive: true
            })
            .select('code discountType discountValue maxDiscount minPurchase startDate endDate')
            .lean();

            console.log('Active coupons before date filtering:', activeCoupons);

            // Filter coupons by date manually to debug
            const validCoupons = activeCoupons.filter(coupon => {
                const isValid = coupon.startDate <= currentDate && coupon.endDate >= currentDate;
                console.log(`Coupon ${coupon.code}:`, {
                    startDate: coupon.startDate,
                    endDate: coupon.endDate,
                    isValid
                });
                return isValid;
            });

            console.log('Final valid coupons:', validCoupons);

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
                    ...item,
                    originalPrice,
                    priceAfterOffer,
                    discountedPrice: priceAfterOffer,
                    offer: applicableOffer,
                    offerDiscountforproduct: offerDiscount * item.quantity,
                    subtotalAfterOffer,
                    gstAmount: itemGstAmount * item.quantity,
                    shippingCost: itemShippingCost * item.quantity,
                    totalPrice: subtotalAfterOffer + (itemGstAmount * item.quantity) + (itemShippingCost * item.quantity),
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
                    // Calculate original subtotal (before any discounts)
                    originalSubtotal += item.originalPrice * item.quantity;
                    
                    // Calculate subtotal after offer
                    totalSubtotalAfterOffers += item.subtotalAfterOffer;
                    
                    // Calculate offer discount
                    totalOfferDiscount += item.offerDiscountforproduct;
                    
                    // Calculate other totals
                    totalGstAmount += item.gstAmount;
                    totalShippingCost += item.shippingCost;
                }
            });

            // Calculate final total
            const total = totalSubtotalAfterOffers + totalGstAmount + totalShippingCost;

            // Get cart count for the navbar
            const cartCount = await CartItem.countDocuments({ userId });

            // Render checkout page with all data
            res.render('user/checkout', {
                user: user,
                walletBalance,
                addresses,
                cartItems: processedCartItems,
                subtotal: totalSubtotalAfterOffers, // Subtotal after offers
                originalSubtotal, // Original price before any discounts
                totalOfferDiscount,
                gstAmount: totalGstAmount,
                shippingCost: totalShippingCost,
                totalAmount: total,
                activeOffers,
                coupons: activeCoupons,
                appliedCoupon: null
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
            const { 
                addressId, 
                paymentMethod, 
                coupon, 
                totalAmount: clientTotalAmount, 
                items: clientItems, 
                originalSubtotal, 
                totalOfferDiscount, 
                totalCouponDiscount,
                subtotal: clientSubtotal,
                gstAmount: clientGstAmount,
                shippingCost: clientShippingCost
            } = req.body;

            console.log("Coupon in place order controller", coupon);
            console.log("Client amounts:", {
                totalAmount: clientTotalAmount,
                subtotal: clientSubtotal,
                gstAmount: clientGstAmount,
                shippingCost: clientShippingCost,
                totalCouponDiscount
            });

            // Validate required fields
            if (!addressId || !paymentMethod || !clientTotalAmount || !clientItems || !clientItems.length) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields'
                });
            }

            // Validate address
            const address = await Address.findOne({ _id: addressId, userId });
            if (!address) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid address selected'
                });
            }

            // Start a session for transaction
            const session = await mongoose.startSession();
            session.startTransaction();

            try {
                // Get cart items with product details
                const cartItems = await CartItem.find({ userId })
                    .populate({
                        path: 'productId',
                        select: 'name images variants brand status category'
                    })
                    .session(session);

                if (!cartItems.length) {
                    throw new Error('Cart is empty');
                }

                // Validate and process each cart item
                const orderItems = [];
                let totalAmount = 0;
                let totalGstAmount = 0;
                let totalShippingCost = 0;
                let subtotalAfterOffers = 0;

                for (const item of cartItems) {
                    const product = await Product.findById(item.productId._id).session(session);
                    if (!product || product.status !== 'Active') {
                        throw new Error(`Product ${item.productId.name} is not available`);
                    }

                    const variant = product.variants.find(v => v.type === item.variantType);
                    if (!variant) {
                        throw new Error(`Variant ${item.variantType} not found for ${product.name}`);
                    }

                    if (variant.stock < item.quantity) {
                        throw new Error(`Insufficient stock for ${product.name} (${item.variantType})`);
                    }

                    // Calculate prices and discounts
                    const originalPrice = variant.price;
                    let priceAfterOffer = originalPrice;
                    let offerDiscount = 0;

                    // Apply offers if any
                    const activeOffers = await Offer.find({
                        isActive: true,
                        startDate: { $lte: new Date() },
                        endDate: { $gte: new Date() }
                    }).session(session);

                    const productOffer = activeOffers.find(offer => 
                        offer.type === 'product' && 
                        offer.productIds.some(id => id.toString() === product._id.toString())
                    );

                    const categoryOffer = activeOffers.find(offer => 
                        offer.type === 'category' && 
                        offer.categoryId.toString() === product.category.toString()
                    );

                    const applicableOffer = productOffer || categoryOffer;
                    if (applicableOffer) {
                        offerDiscount = (originalPrice * applicableOffer.discount) / 100;
                        priceAfterOffer = originalPrice - offerDiscount;
                    }

                    // Calculate GST and shipping
                    const itemGstAmount = Math.round(priceAfterOffer * 0.18);
                    const itemShippingCost = Math.round(priceAfterOffer * 0.02);
                    const itemSubtotal = priceAfterOffer * item.quantity;
                    const itemTotal = itemSubtotal + (itemGstAmount * item.quantity) + (itemShippingCost * item.quantity);

                    // Add to order items
                    orderItems.push({
                        productId: product._id,
                        name: product.name,
                        brand: product.brand,
                        category: product.category,
                        images: product.images,
                        quantity: item.quantity,
                        originalPrice,
                        variantType: item.variantType,
                        status: 'pending',
                        offer: applicableOffer ? {
                            name: applicableOffer.name,
                            type: applicableOffer.type,
                            discount: applicableOffer.discount
                        } : null,
                        offerDiscount,
                        priceAfterOffer,
                        gstAmount: itemGstAmount * item.quantity,
                        shippingCost: itemShippingCost * item.quantity,
                        totalAmount: itemTotal,
                        finalAmount: priceAfterOffer * item.quantity,
                        finalPrice: priceAfterOffer,
                        subtotalforproduct: itemSubtotal
                    });

                    subtotalAfterOffers += itemSubtotal;
                    totalGstAmount += itemGstAmount * item.quantity;
                    totalShippingCost += itemShippingCost * item.quantity;
                }

                // Apply coupon discount if any
                let finalSubtotal = subtotalAfterOffers;
                if (coupon && totalCouponDiscount > 0) {
                    finalSubtotal = subtotalAfterOffers - totalCouponDiscount;
                }

                console.log("Server calculations:", {
                    subtotalAfterOffers,
                    totalCouponDiscount,
                    finalSubtotal,
                    totalGstAmount,
                    totalShippingCost
                });

                // Calculate final total amount
                totalAmount = finalSubtotal + totalGstAmount + totalShippingCost;

                // Use client-provided amounts to ensure consistency
                const orderData = {
                    orderId: uuidv4(),
                    userId,
                    items: orderItems,
                    totalAmount: clientTotalAmount,
                    originalSubtotal,
                    totalOfferDiscount,
                    totalCouponDiscount,
                    subtotal: clientSubtotal,
                    gstAmount: clientGstAmount,
                    shippingCost: clientShippingCost,
                    paymentMethod,
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
                        discount: totalCouponDiscount,
                        type: coupon.type
                    } : null
                };

                // Handle different payment methods
                if (paymentMethod === 'cod') {
                    // For COD, create order directly
                    const order = new Order({
                        ...orderData,
                        paymentStatus: 'pending'
                    });

                    await order.save({ session });
                    await CartItem.deleteMany({ userId }).session(session);
                    await session.commitTransaction();

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
                        await verifyRazorpayConfig();
                        
                        const user = await User.findById(userId).session(session);
                        if (!user) {
                            throw new Error('User not found');
                        }

                        const options = {
                            amount: Math.round(clientTotalAmount * 100),
                            currency: "INR",
                            receipt: `temp_${Date.now()}`,
                            payment_capture: 1,
                            notes: {
                                userId: userId.toString(),
                                subtotal: clientSubtotal,
                                offerDiscount: totalOfferDiscount,
                                couponDiscount: totalCouponDiscount,
                                gst: clientGstAmount,
                                shipping: clientShippingCost,
                                finalAmount: clientTotalAmount,
                                addressId: addressId,
                                items: JSON.stringify(orderItems),
                                coupon: coupon ? JSON.stringify(coupon) : null
                            }
                        };

                        const razorpayOrder = await razorpay.orders.create(options);
                        if (!razorpayOrder || !razorpayOrder.id) {
                            throw new Error('Failed to create Razorpay order');
                        }

                        await session.commitTransaction();

                        return res.json({
                            success: true,
                            message: 'Payment initialized',
                            razorpayOrder: {
                                id: razorpayOrder.id,
                                amount: Math.round(clientTotalAmount * 100),
                                currency: 'INR',
                                key: process.env.RAZORPAY_KEY_ID,
                                name: 'Royal Monarch',
                                description: 'Order Payment',
                                prefill: {
                                    name: `${user.firstname} ${user.lastname || ''}`,
                                    email: user.email,
                                    contact: user.phone
                                },
                                theme: {
                                    color: '#000000'
                                }
                            }
                        });
                    } catch (razorpayError) {
                        await session.abortTransaction();
                        throw new Error(razorpayError.error?.description || razorpayError.message || 'Failed to create payment order');
                    }
                }
                else if (paymentMethod === 'wallet') {
                    // For wallet payment, create order directly
                    const order = new Order({
                        ...orderData,
                        paymentStatus: 'paid',
                        paymentDetails: {
                            status: 'paid',
                            createdAt: new Date()
                        }
                    });

                    // Update wallet balance
                    const wallet = await Wallet.findOne({ userId }).session(session);
                    if (!wallet) {
                        throw new Error('Wallet not found');
                    }

                    if (wallet.balance < clientTotalAmount) {
                        throw new Error('Insufficient wallet balance');
                    }

                    // Deduct amount from wallet
                    wallet.balance -= clientTotalAmount;

                    // Add transaction record
                    wallet.transactions.push({
                        transactionId: order.orderId,
                        type: 'DEBIT',
                        amount: clientTotalAmount,
                        description: `Payment for order ${order.orderId}`,
                        date: new Date()
                    });

                    await wallet.save({ session });
                    await order.save({ session });
                    await CartItem.deleteMany({ userId }).session(session);
                    await session.commitTransaction();

                    return res.json({
                        success: true,
                        paymentMethod: 'wallet',
                        redirect: `/order/success/${order.orderId}`
                    });
                }

            } catch (error) {
                await session.abortTransaction();
                throw error;
            } finally {
                session.endSession();
            }

        } catch (error) {
            console.error('Create Order Error:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to create order'
            });
        }
    },

    retryPayment: async (req, res) => {
        try {
            const { orderId } = req.params;
            const userId = req.session.userId;

            // Find the order
            const order = await Order.findOne({ 
                orderId,
                userId,
                paymentMethod: 'online',
                paymentStatus: 'pending'
            });

            if (!order) {
                return res.status(404).json({
                    success: false,
                    message: 'Order not found or not eligible for payment retry'
                });
            }

            // Create new Razorpay order
            const options = {
                amount: Math.round(order.totalAmount * 100), // Convert to paise
                currency: "INR",
                receipt: order.orderId,
                notes: {
                    orderId: order.orderId,
                    userId: userId.toString()
                }
            };

            const razorpayOrder = await razorpay.orders.create(options);

            if (!razorpayOrder || !razorpayOrder.id) {
                throw new Error('Failed to create Razorpay order');
            }

            // Update order with new Razorpay order ID
            order.paymentDetails.razorpayOrderId = razorpayOrder.id;
            await order.save();

            res.json({
                success: true,
                razorpayKey: process.env.RAZORPAY_KEY_ID,
                amount: Math.round(order.totalAmount * 100),
                currency: "INR",
                order_id: razorpayOrder.id,
                customerName: req.session.user.name,
                customerEmail: req.session.user.email,
                customerPhone: req.session.user.phone
            });

        } catch (error) {
            console.error('Retry Payment Error:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to process payment retry'
            });
        }
    },

    getPaymentFailed: async (req, res) => {
        console.log('getPaymentFailed called');
        try {
            const { orderId } = req.params;
            const userId = req.session.userId;

            // Find the order
            const order = await Order.findOne({ 
                orderId,
                userId,
                paymentMethod: 'online',
                paymentStatus: 'pending'
            });
            console.log('getPaymentFailed Order found'+order);

            if (!order) {
                return res.redirect('/orders');
            }

            res.render('user/paymentFailed', {
                orderId: order.orderId,
                user: req.session.user
            });
        } catch (error) {
            console.error('Error in payment failed controller:', error);
            res.redirect('/orders');
        }
    },

    verifyPayment: async (req, res) => {
        try {
            console.log('verifyPayment called');
            const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;

            // Start a transaction session
            const session = await mongoose.startSession();
            session.startTransaction();

            try {
                // Fetch the Razorpay order details
                const razorpayOrder = await razorpay.orders.fetch(razorpay_order_id);
                
                // Extract order data from Razorpay notes
                const notes = razorpayOrder.notes;
                const userId = new mongoose.Types.ObjectId(notes.userId);
                const addressId = new mongoose.Types.ObjectId(notes.addressId);
                const items = JSON.parse(notes.items);
                const coupon = notes.coupon ? JSON.parse(notes.coupon) : null;

                // Check if this is a modal dismissal (no payment_id or signature)
                const isModalDismissed = !razorpay_payment_id || !razorpay_signature;

                // Create the order - always set paymentStatus as pending initially
                const newOrderId = uuidv4();
                const order = new Order({
                    orderId: newOrderId,
                    userId,
                    items,
                    totalAmount: razorpayOrder.amount / 100, // Convert from paise to rupees
                    originalSubtotal: notes.subtotal,
                    totalOfferDiscount: notes.offerDiscount,
                    totalCouponDiscount: notes.couponDiscount,
                    subtotal: notes.subtotal,
                    gstAmount: notes.gst,
                    shippingCost: notes.shipping,
                    paymentMethod: 'online',
                    paymentStatus: 'pending', // Always set as pending initially
                    shippingAddress: await Address.findById(addressId).select('name houseName localityStreet city state pincode phone alternatePhone'),
                    expectedDeliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    coupon: coupon ? {
                        code: coupon.code,
                        discount: notes.couponDiscount,
                        type: coupon.type
                    } : null,
                    paymentDetails: {
                        razorpayOrderId: razorpay_order_id,
                        razorpayPaymentId: razorpay_payment_id || '',
                        razorpaySignature: razorpay_signature || '',
                        status: isModalDismissed ? 'cancelled' : 'failed',
                        createdAt: new Date()
                    }
                });

                // Save the order
                await order.save({ session });
                console.log('verifyPayment Order saved');

                // Update product stock
                for (const item of items) {
                    const product = await Product.findById(item.productId).session(session);
                    if (!product) {
                        throw new Error(`Product ${item.productId} not found`);
                    }

                    const variant = product.variants.find(v => v.type === item.variantType);
                    if (!variant) {
                        throw new Error(`Variant ${item.variantType} not found for product ${product.name}`);
                    }

                    if (variant.stock < item.quantity) {
                        throw new Error(`Insufficient stock for ${product.name} (${item.variantType})`);
                    }

                    variant.stock -= item.quantity;
                    await product.save({ session });
                }

                // Update coupon usage if applied
                if (coupon) {
                    const couponDoc = await Coupon.findOne({ code: coupon.code }).session(session);
                    if (couponDoc) {
                        couponDoc.usageHistory.push({
                            userId,
                            orderId: newOrderId,
                            usedAt: new Date(),
                            usedCount: 1
                        });
                        await couponDoc.save({ session });
                    }
                }

                // Clear the cart
                await CartItem.deleteMany({ userId }).session(session);

                // Commit the transaction
                await session.commitTransaction();

                // If this is a modal dismissal, return failed response
                if (isModalDismissed) {
                    return res.json({
                        success: false,
                        orderId: newOrderId,
                        redirect: `/payment/failed/${newOrderId}`
                    });
                }

                // Verify the payment signature for actual payment attempts
                const body = razorpay_order_id + "|" + razorpay_payment_id;
                const expectedSignature = crypto
                    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                    .update(body.toString())
                    .digest('hex');

                // Return response based on verification status
                if (expectedSignature === razorpay_signature) {
                    // Update order status to paid if verification succeeds
                    await Order.findByIdAndUpdate(order._id, {
                        paymentStatus: 'paid',
                        'paymentDetails.status': 'paid'
                    });
                    
                    return res.json({
                        success: true,
                        orderId: newOrderId,
                        redirect: `/order/success/${newOrderId}`
                    });
                } else {
                    return res.json({
                        success: false,
                        orderId: newOrderId,
                        redirect: `/payment/failed/${newOrderId}`
                    });
                }

            } catch (error) {
                await session.abortTransaction();
                throw error;
            } finally {
                session.endSession();
            }

        } catch (error) {
            console.error('Payment verification error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Error verifying payment'
            });
        }
    }
};

export default orderController;

