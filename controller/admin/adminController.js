import { config } from 'dotenv';
import User from '../../model/userModel.js';
import Order from '../../model/orderModel.js';
import Product from '../../model/productModel.js';
import Category from '../../model/categoryModel.js';

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

        // Calculate total revenue from delivered items properly
        let totalRevenue = 0;
        orders.forEach(order => {
            order.items.forEach(item => {
                if (item.status === 'delivered') {
                    totalRevenue += item.finalPrice * item.quantity;
                }
            });
        });

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
                    revenue: { $sum: { $multiply: ['$items.finalPrice', '$items.quantity'] } }
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
                    revenue: { $sum: { $multiply: ['$items.finalPrice', '$items.quantity'] } }
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

export default { 
    getAdmin, 
    postAdmin, 
    getLogout, 
    getDashboard,
    getChartData 
};