import Order from '../../model/orderModel.js';

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
        const { status, itemId } = req.body;

        const order = await Order.findOne({ orderId: orderId });
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const itemIndex = order.items.findIndex(item => item._id.toString() === itemId);
        if (itemIndex === -1) {
            return res.status(404).json({ success: false, message: 'Item not found in order' });
        }

        const item = order.items[itemIndex];

        // Define allowed status transitions based on current status
        const statusTransitions = {
            'pending': ['processing','order rejected'],
            'processing': ['shipped', 'order rejected'],
            'shipped': ['delivered', 'order rejected'],
            'delivered': ['return requested'],
            'return requested': ['returned', 'return rejected'],
            'cancelled': [],
            'order rejected': [],
            'returned': [],
            'return rejected': []
        };

        // Check if the status transition is allowed
        if (!statusTransitions[item.status]?.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status transition'
            });
        }

        // Update status and corresponding dates
        const now = new Date();
        order.items[itemIndex].status = status;

        // Update dates based on status
        switch (status) {
            case 'shipped':
                order.items[itemIndex].shippedDate = now;
                // Calculate expected delivery date (e.g., 5 days from shipping)
                order.expectedDeliveryDate = new Date(now.getTime() + (5 * 24 * 60 * 60 * 1000));
                break;

            case 'delivered':
                order.items[itemIndex].deliveredDate = now;
                order.deliveryDate = now;
                if (order.paymentMethod === 'cod') {
                    order.paymentStatus = 'paid';
                }
                break;

            case 'order rejected':
                if (order.paymentStatus === 'paid') {
                    order.paymentStatus = 'refunded';
                }
                break;

            case 'returned':
                order.items[itemIndex].returnedDate = now;
                if (order.paymentStatus === 'paid') {
                    order.paymentStatus = 'refunded';
                }
                break;
        }

        await order.save();

        res.json({
            success: true,
            message: `Order ${status.replace('_', ' ')} successfully`,
            newStatus: status
        });
    } catch (error) {
        console.error('Error updating order status:', error);
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
