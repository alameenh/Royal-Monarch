import { config } from 'dotenv';
import User from '../../model/userModel.js';
import Order from '../../model/orderModel.js';
import Product from '../../model/productModel.js';
import Category from '../../model/categoryModel.js';
import PDFDocument from 'pdfkit';

config()

const getAdmin = (req, res) => {
    res.render('admin/login');
}

const postAdmin = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email address'
            });
        }

        if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
            
            req.session.admin = true;
            console.log('loginned')
            return res.json({
                success: true,
                message: 'Login successful',
                redirectUrl: '/admin/dashboard'
            });
        } else {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }
    } catch (error) {
        console.error('Admin login error:', error);
        return res.status(500).json({
            success: false,
            message: 'An error occurred during login'
        });
    }
}

const getLogout = (req, res) => {
    // Only clear admin-related session data
    delete req.session.admin;
    res.redirect('/admin/login');
}

const getDashboard = async (req, res) => {
    try {
        // Get counts
        const [userCount, productCount] = await Promise.all([
            User.countDocuments({ isBlocked: { $ne: true } }),
            Product.countDocuments({ status: 'Active' })
        ]);
        
        // Get all orders
        const orders = await Order.find({});
        const orderCount = orders.length;

        // Calculate total revenue from delivered items including GST and shipping
        const totalRevenueData = await Order.aggregate([
            {
                $addFields: {
                    itemCount: { $size: '$items' }
                }
            },
            {
                $unwind: '$items'
            },
            {
                $match: {
                    'items.status': 'delivered'
                }
            },
            {
                $group: {
                    _id: null,
                    totalRevenue: {
                        $sum: {
                            $add: [
                                { $multiply: ['$items.finalAmount', '$items.quantity'] }, // Final amount per item
                                { $multiply: ['$items.gstAmount', '$items.quantity'] }, // GST per item
                                { $divide: ['$shippingCost', '$itemCount'] } // Shipping cost per item (divided by total items in order)
                            ]
                        }
                    }
                }
            }
        ]);

        const totalRevenue = totalRevenueData[0]?.totalRevenue || 0;

        // Get top 10 products based on sold count
        const topProducts = await Product.find({})
            .sort({ soldcount: -1 })
            .limit(10)
            .select('name brand soldcount');

        // Get top categories with proper category name lookup
        const topCategories = await Product.aggregate([
            {
                $match: { status: 'Active' }
            },
            {
                $lookup: {
                    from: 'categories',
                    localField: 'category',
                    foreignField: '_id',
                    as: 'categoryInfo'
                }
            },
            {
                $unwind: '$categoryInfo'
            },
            {
                $group: {
                    _id: '$category',
                    name: { $first: '$categoryInfo.name' },
                    count: { $sum: '$soldcount' }
                }
            },
            {
                $sort: { count: -1 }
            },
            {
                $limit: 10
            }
        ]);

        // Get top brands based on sold count
        const topBrands = await Product.aggregate([
            {
                $match: { status: 'Active' }
            },
            {
                $group: {
                    _id: '$brand',
                    count: { $sum: '$soldcount' }
                }
            },
            {
                $sort: { count: -1 }
            },
            {
                $limit: 10
            }
        ]);

        // Get orders for chart data (default: last 7 days)
        const last7Days = new Date();
        last7Days.setDate(last7Days.getDate() - 7);

        const orderData = await Order.aggregate([
            {
                $match: {
                    orderDate: { $gte: last7Days }
                }
            },
            {
                $addFields: {
                    itemCount: { $size: '$items' }
                }
            },
            {
                $unwind: '$items'
            },
            {
                $match: {
                    'items.status': 'delivered'
                }
            },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$orderDate" } },
                    count: { $sum: '$items.quantity' },
                    revenue: {
                        $sum: {
                            $add: [
                                { $multiply: ['$items.finalAmount', '$items.quantity'] }, // Final amount per item
                                { $multiply: ['$items.gstAmount', '$items.quantity'] }, // GST per item
                                { $divide: ['$shippingCost', '$itemCount'] } // Shipping cost per item
                            ]
                        }
                    }
                }
            },
            {
                $sort: { _id: 1 }
            }
        ]);

        // Ensure we have data for all days in the range
        const result = [];
        const endDate = new Date();
        let currentDate = new Date(last7Days);
        
        while (currentDate <= endDate) {
            const dateStr = currentDate.toISOString().split('T')[0];
            const existingData = orderData.find(item => item._id === dateStr);
            
            if (existingData) {
                result.push(existingData);
            } else {
                result.push({
                    _id: dateStr,
                    count: 0,
                    revenue: 0
                });
            }
            
            currentDate.setDate(currentDate.getDate() + 1);
        }

        res.render('admin/dashboard', {
            userCount,
            productCount,
            orderCount,
            totalRevenue,
            topProducts,
            topCategories,
            topBrands,
            orderData: JSON.stringify(result)
        });
    } catch (error) {
        console.error('Dashboard Error:', error);
        res.status(500).send(`Error loading dashboard: ${error.message}`);
    }
};

const getChartData = async (req, res) => {
    try {
        const { filter, startDate, endDate } = req.query;
        
        console.log('Received chart request with filter:', filter, 'startDate:', startDate, 'endDate:', endDate);
        
        let queryStartDate = new Date();
        let queryEndDate = new Date();
        queryEndDate.setHours(23, 59, 59, 999); // Set to end of day

        if (filter === 'custom' && startDate && endDate) {
            // Custom date range
            queryStartDate = new Date(startDate);
            queryStartDate.setHours(0, 0, 0, 0); // Start of day
            
            queryEndDate = new Date(endDate);
            queryEndDate.setHours(23, 59, 59, 999); // End of day
            
            // Validate date range
            if (queryStartDate > queryEndDate) {
                return res.status(400).json({
                    error: 'Invalid date range',
                    details: 'Start date cannot be after end date'
                });
            }
        } else {
            // Predefined ranges
            switch (filter) {
                case 'day':
                    queryStartDate.setHours(0, 0, 0, 0); // Start of today
                    break;
                case 'week':
                    queryStartDate.setDate(queryStartDate.getDate() - 7);
                    queryStartDate.setHours(0, 0, 0, 0);
                    break;
                case 'month':
                    queryStartDate.setMonth(queryStartDate.getMonth() - 1);
                    queryStartDate.setHours(0, 0, 0, 0);
                    break;
                default:
                    // Default to week if not a known filter
                    queryStartDate.setDate(queryStartDate.getDate() - 7);
                    queryStartDate.setHours(0, 0, 0, 0);
            }
        }

        console.log(`Fetching chart data from ${queryStartDate.toISOString()} to ${queryEndDate.toISOString()}`);

        // Find orders within the date range
        const orderData = await Order.aggregate([
            {
                $match: {
                    orderDate: { 
                        $gte: queryStartDate,
                        $lte: queryEndDate
                    }
                }
            },
            {
                $addFields: {
                    itemCount: { $size: '$items' }
                }
            },
            {
                $unwind: '$items'
            },
            {
                $match: {
                    'items.status': 'delivered'
                }
            },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$orderDate" } },
                    count: { $sum: '$items.quantity' },
                    revenue: {
                        $sum: {
                            $add: [
                                { $multiply: ['$items.finalAmount', '$items.quantity'] }, // Final amount per item
                                { $multiply: ['$items.gstAmount', '$items.quantity'] }, // GST per item
                                { $divide: ['$shippingCost', '$itemCount'] } // Shipping cost per item
                            ]
                        }
                    }
                }
            },
            {
                $sort: { _id: 1 }
            }
        ]);

        console.log(`Query returned ${orderData.length} data points`);
        
        // Fill in missing dates in the range with zero values
        const result = [];
        let currentDate = new Date(queryStartDate);
        
        while (currentDate <= queryEndDate) {
            const dateStr = currentDate.toISOString().split('T')[0];
            const existingData = orderData.find(item => item._id === dateStr);
            
            if (existingData) {
                result.push(existingData);
            } else {
                result.push({
                    _id: dateStr,
                    count: 0,
                    revenue: 0
                });
            }
            
            // Move to next day
            currentDate.setDate(currentDate.getDate() + 1);
        }

        console.log(`Returning ${result.length} data points with filled dates`);
        res.json(result);
    } catch (error) {
        console.error('Chart Data Error:', error);
        res.status(500).json({ error: 'Error fetching chart data', details: error.message });
    }
};

const generateInvoice = async (req, res) => {
    try {
        const { userId, orderId, itemId } = req.params;

        // Get user details
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).send('User not found');
        }

        // Get order details
        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).send('Order not found');
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
        doc.fontSize(22).text('Royal Monarch', { align: 'center' });
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
        doc.text(`Name: ${user.firstname} ${user.lastname || ''}`, leftColumnX, customerY);
        doc.text(`Email: ${user.email}`, leftColumnX, customerY + 15);
        doc.text(`Phone: ${user.phone || 'N/A'}`, leftColumnX, customerY + 30);
        
        // Move to next section - Shipping Details
        doc.moveDown(2);
        
        doc.font('Helvetica-Bold').fontSize(14).text('Shipping Details', leftColumnX);
        doc.moveDown(0.5);
        
        doc.font('Helvetica').fontSize(10);
        doc.text(`Address: ${order.shippingAddress.street}, ${order.shippingAddress.city}, ${order.shippingAddress.state}, ${order.shippingAddress.zip}`, leftColumnX, doc.y);
        doc.text(`Country: ${order.shippingAddress.country}`, leftColumnX, doc.y + 15);
        
        // Move to next section - Item Details
        doc.moveDown(2);
        
        doc.font('Helvetica-Bold').fontSize(14).text('Item Details', leftColumnX);
        doc.moveDown(0.5);
        
        doc.font('Helvetica').fontSize(10);
        const item = order.items.find(i => i._id.toString() === itemId);
        if (item) {
            doc.text(`Name: ${item.product.name}`, leftColumnX, doc.y);
            doc.text(`Quantity: ${item.quantity}`, leftColumnX, doc.y + 15);
            doc.text(`Price: $${item.finalAmount.toFixed(2)}`, leftColumnX, doc.y + 30);
            doc.text(`Total: $${(item.finalAmount * item.quantity).toFixed(2)}`, leftColumnX, doc.y + 45);
        }
        
        // Move to next section - Total Details
        doc.moveDown(2);
        
        doc.font('Helvetica-Bold').fontSize(14).text('Total Details', leftColumnX);
        doc.moveDown(0.5);
        
        doc.font('Helvetica').fontSize(10);
        doc.text(`Subtotal: $${order.subtotal.toFixed(2)}`, leftColumnX, doc.y);
        doc.text(`GST: $${order.gstAmount.toFixed(2)}`, leftColumnX, doc.y + 15);
        doc.text(`Shipping: $${order.shippingCost.toFixed(2)}`, leftColumnX, doc.y + 30);
        doc.text(`Total: $${order.total.toFixed(2)}`, leftColumnX, doc.y + 45);
        
        // Move to next section - Payment Details
        doc.moveDown(2);
        
        doc.font('Helvetica-Bold').fontSize(14).text('Payment Details', leftColumnX);
        doc.moveDown(0.5);
        
        doc.font('Helvetica').fontSize(10);
        doc.text(`Payment ID: ${order.paymentId}`, leftColumnX, doc.y);
        doc.text(`Transaction ID: ${order.transactionId}`, leftColumnX, doc.y + 15);
        
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
        
        // Calculate prices exactly as in cancelOrderItem
        const finalAmount = Number(item.finalAmount);
        const gstAmount = Number(item.gstAmount);
        const itemTotal = finalAmount + gstAmount;
        
        // Calculate proportional shipping cost
        const itemCount = order.items.length;
        const itemShippingCost = Number((order.shippingCost / itemCount).toFixed(2));
        
        // Item row
        doc.text(item.name, colPositions.item);
        doc.text(item.variantType || 'Standard', colPositions.variant, doc.y - 12);
        doc.text(item.quantity.toString(), colPositions.qty, doc.y - 12);
        doc.text(`₹${(finalAmount / item.quantity).toFixed(2)}`, colPositions.price, doc.y - 12);
        doc.text(`₹${finalAmount.toFixed(2)}`, colPositions.total, doc.y - 12);
        
        // Price breakdown
        doc.moveDown(0.5);
        doc.font('Helvetica').fontSize(9);
        doc.text('Price Breakdown:', colPositions.item);
        doc.moveDown(0.3);
        doc.text(`Final Amount (${item.quantity} items): ₹${finalAmount.toFixed(2)}`, colPositions.item + 20);
        doc.text(`GST: ₹${gstAmount.toFixed(2)}`, colPositions.item + 20, doc.y + 2);
        doc.text(`Item Total: ₹${itemTotal.toFixed(2)}`, colPositions.item + 20, doc.y + 2);
        
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
        doc.text('Final Amount:', totalLabelX, subtotalY, { align: 'left' });
        doc.text(`₹${finalAmount.toFixed(2)}`, totalValueX, subtotalY, { align: 'right' });
        
        const gstY = subtotalY + 20;
        doc.text('GST:', totalLabelX, gstY, { align: 'left' });
        doc.text(`₹${gstAmount.toFixed(2)}`, totalValueX, gstY, { align: 'right' });
        
        const shippingY = gstY + 20;
        doc.text('Shipping (Non-refundable):', totalLabelX, shippingY, { align: 'left' });
        doc.text(`₹${itemShippingCost.toFixed(2)}`, totalValueX, shippingY, { align: 'right' });
        
        // Add a note about shipping cost
        doc.font('Helvetica').fontSize(8);
        doc.text('Note: Shipping cost is non-refundable and will not be included in returns or cancellations.', 50, shippingY + 15);
        
        // Total with background highlight
        const grandTotalY = shippingY + 35;
        doc.rect(totalLabelX - 10, grandTotalY - 5, 180, 25).fill('#f0f0f0');
        doc.fill('black');
        
        doc.fontSize(12).font('Helvetica-Bold');
        doc.text('Grand Total:', totalLabelX, grandTotalY, { align: 'left' });
        doc.text(`₹${(itemTotal + itemShippingCost).toFixed(2)}`, totalValueX, grandTotalY, { align: 'right' });
        
        // Finalize the PDF
        doc.end();
    } catch (error) {
        console.error('Invoice Generation Error:', error);
        res.status(500).json({ error: 'Error generating invoice', details: error.message });
    }
};

export default { 
    getAdmin, 
    postAdmin, 
    getLogout, 
    getDashboard,
    getChartData,
    generateInvoice
};