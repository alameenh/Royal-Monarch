import Order from '../../model/orderModel.js';
import Product from '../../model/productModel.js';
import Wallet from '../../model/walletModel.js';
import { v4 as uuidv4 } from 'uuid';

const ITEMS_PER_PAGE = 10;

const getOrders = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const status = req.query.status || '';
        const paymentMethod = req.query.paymentMethod || '';
        
        // Build filter object
        const filter = {};
        if (status) filter['items.status'] = status;
        if (paymentMethod) filter.paymentMethod = paymentMethod;

        // Count total documents with filter
        const totalOrders = await Order.countDocuments(filter);
        const totalPages = Math.ceil(totalOrders / ITEMS_PER_PAGE);

        // Get orders with pagination
        const orders = await Order.find(filter)
            .sort({ orderDate: -1 })
            .skip((page - 1) * ITEMS_PER_PAGE)
            .limit(ITEMS_PER_PAGE)
            .populate('userId', 'name email');

        res.render('admin/orderManage', {
            orders,
            currentPage: page,
            totalPages,
            status,
            paymentMethod,
            hasNextPage: ITEMS_PER_PAGE * page < totalOrders,
            hasPreviousPage: page > 1,
            nextPage: page + 1,
            previousPage: page - 1,
            lastPage: totalPages
        });
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).render('error', { message: 'Error fetching orders' });
    }
};

const searchOrders = async (req, res) => {
    try {
        const searchQuery = req.query.q;
        const page = parseInt(req.query.page) || 1;

        const searchFilter = {
            $or: [
                { orderId: { $regex: searchQuery, $options: 'i' } },
                { 'shippingAddress.name': { $regex: searchQuery, $options: 'i' } }
            ]
        };

        const totalOrders = await Order.countDocuments(searchFilter);
        const totalPages = Math.ceil(totalOrders / ITEMS_PER_PAGE);

        const orders = await Order.find(searchFilter)
            .sort({ orderDate: -1 })
            .skip((page - 1) * ITEMS_PER_PAGE)
            .limit(ITEMS_PER_PAGE)
            .populate('userId', 'name email');

        res.render('admin/orderManage', {
            orders,
            currentPage: page,
            totalPages,
            searchQuery,
            hasNextPage: ITEMS_PER_PAGE * page < totalOrders,
            hasPreviousPage: page > 1,
            nextPage: page + 1,
            previousPage: page - 1,
            lastPage: totalPages
        });
    } catch (error) {
        console.error('Error searching orders:', error);
        res.status(500).render('error', { message: 'Error searching orders' });
    }
};

const updateOrderStatus = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { itemId, status } = req.body;

        const order = await Order.findOne({ orderId });
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

        // Handle refunds for online payments
        if ((status === 'order rejected' || status === 'cancelled') && 
            order.paymentMethod === 'online' && 
            order.paymentStatus === 'paid') {
            
            // Calculate base refund amount for this item
            const itemBasePrice = (item.price - (item.price * (item.discount || 0) / 100)) * item.quantity;
            let refundAmount = itemBasePrice;

            // If order has coupon, calculate proportional coupon discount
            if (order.coupon && order.coupon.discount > 0) {
                // Calculate total order value (before coupon)
                const orderTotalBeforeCoupon = order.items.reduce((sum, orderItem) => {
                    const itemPrice = (orderItem.price - (orderItem.price * (orderItem.discount || 0) / 100)) * orderItem.quantity;
                    return sum + itemPrice;
                }, 0);

                // Calculate this item's proportion of the total order
                const itemProportion = itemBasePrice / orderTotalBeforeCoupon;
                
                // Calculate this item's share of the coupon discount
                const itemCouponDiscount = order.coupon.discount * itemProportion;
                
                // Add proportional coupon discount to refund
                refundAmount += itemCouponDiscount;
            }

            // Find or create user's wallet
            let wallet = await Wallet.findOne({ userId: order.userId });
            if (!wallet) {
                wallet = new Wallet({
                    userId: order.userId,
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

            // Update product stock
            const product = await Product.findOne({
                name: item.name,
                'variants.type': item.variantType
            });

            if (product) {
                const variant = product.variants.find(v => v.type === item.variantType);
                if (variant) {
                    variant.stock += item.quantity;
                    await product.save();
                }
            }
        }

        // Handle return approval refunds
        if (status === 'returned' && item.status === 'return requested') {
            // Calculate base refund amount
            const itemBasePrice = (item.price - (item.price * (item.discount || 0) / 100)) * item.quantity;
            let refundAmount = itemBasePrice;

            // If order has coupon, calculate proportional coupon discount
            if (order.coupon && order.coupon.discount > 0) {
                const orderTotalBeforeCoupon = order.items.reduce((sum, orderItem) => {
                    const itemPrice = (orderItem.price - (orderItem.price * (orderItem.discount || 0) / 100)) * orderItem.quantity;
                    return sum + itemPrice;
                }, 0);

                const itemProportion = itemBasePrice / orderTotalBeforeCoupon;
                const itemCouponDiscount = order.coupon.discount * itemProportion;
                refundAmount += itemCouponDiscount;
            }

            // Find or create user's wallet
            let wallet = await Wallet.findOne({ userId: order.userId });
            if (!wallet) {
                wallet = new Wallet({
                    userId: order.userId,
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
                description: `Refund for returned item ${order.orderId} (${item.name})`,
                date: new Date()
            });

            await wallet.save();

            // Update product stock
            const product = await Product.findOne({
                name: item.name,
                'variants.type': item.variantType
            });

            if (product) {
                const variant = product.variants.find(v => v.type === item.variantType);
                if (variant) {
                    variant.stock += item.quantity;
                    await product.save();
                }
            }
        }

        // Update item status
        item.status = status;
        if (status === 'delivered') {
            item.deliveredDate = new Date();
        } else if (status === 'returned') {
            item.returnedDate = new Date();
        } else if (status === 'cancelled' || status === 'order rejected') {
            item.cancelledDate = new Date();
        }

        await order.save();

        res.json({
            success: true,
            message: 'Order status updated successfully'
        });

    } catch (error) {
        console.error('Update Order Status Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating order status'
        });
    }
};

export default {
    getOrders,
    searchOrders,
    updateOrderStatus
};
