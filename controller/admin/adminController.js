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
    req.session.destroy(() => {
        res.redirect('/admin/login');
    });
}

const getDashboard = async (req, res) => {
    try {
        // Get counts
        const [userCount, productCount, orderCount] = await Promise.all([
            User.countDocuments(),
            Product.countDocuments(),
            Order.countDocuments()
        ]);
        
        // Calculate total revenue from delivered orders
        const deliveredOrders = await Order.find({
            'items.status': 'delivered'
        });
        const totalRevenue = deliveredOrders.reduce((acc, order) => acc + order.totalAmount, 0);

        // Get today's statistics
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const [todayOrders, todayRevenue] = await Promise.all([
            Order.countDocuments({
                orderDate: { $gte: today, $lt: tomorrow }
            }),
            Order.aggregate([
                {
                    $match: {
                        orderDate: { $gte: today, $lt: tomorrow }
                    }
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: "$totalAmount" }
                    }
                }
            ])
        ]);

        const todayRevenueAmount = todayRevenue[0]?.total || 0;

        // Get orders for chart data (default: last 7 days)
        const last7Days = new Date();
        last7Days.setDate(last7Days.getDate() - 7);

        const orderData = await Order.aggregate([
            {
                $match: {
                    'items.status': 'delivered',
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
                    count: { $sum: "$items.quantity" },
                    revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } }
                }
            },
            {
                $sort: { _id: 1 }
            }
        ]);

        res.render('admin/dashboard', {
            userCount,
            productCount,
            orderCount,
            totalRevenue,
            todayOrders,
            todayRevenue: todayRevenueAmount,
            orderData: JSON.stringify(orderData)
        });
    } catch (error) {
        console.error('Dashboard Error:', error);
        res.status(500).render('error', { message: 'Error loading dashboard' });
    }
};

const getChartData = async (req, res) => {
    try {
        const { filter, startDate, endDate } = req.query;
        let queryStartDate = new Date();
        let queryEndDate = new Date();

        if (startDate && endDate) {
            // Custom date range
            queryStartDate = new Date(startDate);
            queryEndDate = new Date(endDate);
        } else {
            // Predefined ranges
            switch (filter) {
                case 'day':
                    queryStartDate.setHours(0, 0, 0, 0);
                    break;
                case 'week':
                    queryStartDate.setDate(queryStartDate.getDate() - 7);
                    break;
                case 'month':
                    queryStartDate.setMonth(queryStartDate.getMonth() - 1);
                    break;
                default:
                    queryStartDate.setDate(queryStartDate.getDate() - 7); // default to week
            }
        }

        const orderData = await Order.aggregate([
            {
                $match: {
                    'items.status': 'delivered',
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
                    count: { $sum: "$items.quantity" },
                    revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } }
                }
            },
            {
                $sort: { _id: 1 }
            }
        ]);

        res.json(orderData);
    } catch (error) {
        console.error('Chart Data Error:', error);
        res.status(500).json({ error: 'Error fetching chart data' });
    }
};

export default { 
    getAdmin, 
    postAdmin, 
    getLogout, 
    getDashboard,
    getChartData 
};