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
        if ((status === 'rejected' || status === 'cancelled') && 
            order.paymentMethod === 'online' && 
            order.paymentStatus === 'paid') {
            
            // Calculate refund amount using the same logic as cancelOrder
            const itemRefundAmount = Number(item.finalAmount) + Number(item.gstAmount);
            const refundDetails = {
                finalAmount: Number(item.finalAmount),
                gstAmount: Number(item.gstAmount),
                shippingCost: 0
            };
            
            console.log(`Processing refund for item ${item.name}, amount: ${itemRefundAmount}`);

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
            wallet.balance += itemRefundAmount;
            wallet.transactions.push({
                transactionId: uuidv4(),
                type: 'CREDIT',
                amount: itemRefundAmount,
                description: `Refund for ${status === 'rejected' ? 'rejected' : 'cancelled'} order ${order.orderId} (${item.name})`,
                refundDetails: refundDetails,
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
            // Calculate refund amount using the same logic as cancelOrder
            const itemRefundAmount = Number(item.finalAmount) + Number(item.gstAmount);
            const refundDetails = {
                finalAmount: Number(item.finalAmount),
                gstAmount: Number(item.gstAmount),
                shippingCost: 0
            };
            
            console.log(`Processing refund for returned item ${item.name}, amount: ${itemRefundAmount}`);

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
            wallet.balance += itemRefundAmount;
            wallet.transactions.push({
                transactionId: uuidv4(),
                type: 'CREDIT',
                amount: itemRefundAmount,
                description: `Refund for returned item ${order.orderId} (${item.name})`,
                refundDetails: refundDetails,
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
            
            // For COD orders, update payment status to paid when delivered
            if (order.paymentMethod === 'cod' && order.paymentStatus === 'pending') {
                order.paymentStatus = 'paid';
                order.paymentDetails = {
                    status: 'paid',
                    updatedAt: new Date()
                };
            }
            
            // Update product soldcount when status is changed to delivered
            try {
                const product = await Product.findById(item.productId);
                if (product) {
                    // Increment soldcount by the quantity purchased
                    product.soldcount = (product.soldcount || 0) + item.quantity;
                    await product.save();
                    console.log(`Updated soldcount for product ${product.name}, new count: ${product.soldcount}`);
                }
            } catch (err) {
                console.error(`Error updating soldcount for product ${item.productId}:`, err);
                // Continue with status update even if soldcount update fails
            }
        } else if (status === 'returned') {
            item.returnedDate = new Date();
            
            // Decrement soldcount if the item was delivered (check deliveredDate)
            if (item.deliveredDate) {
                try {
                    const product = await Product.findById(item.productId);
                    if (product) {
                        // Ensure soldcount doesn't go below 0
                        product.soldcount = Math.max(0, (product.soldcount || 0) - item.quantity);
                        await product.save();
                        console.log(`Decreased soldcount for returned product ${product.name}, new count: ${product.soldcount}`);
                    }
                } catch (err) {
                    console.error(`Error updating soldcount for returned product ${item.productId}:`, err);
                }
            }
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
