import Order from '../../model/orderModel.js';
import User from '../../model/userModel.js';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit-table';

const getSalesReport = async (req, res) => {
    try {
        const { filter, startDate, endDate } = req.query;
        
        // Base query for orders with delivered items
        let query = {
            'items.status': 'delivered'
        };

        // Date filter for item deliveredDate
        let dateFilter = {};
        if (filter) {
            const now = new Date();
            const startOfDay = new Date(now.setHours(0, 0, 0, 0));
            
            switch (filter) {
                case 'daily':
                    dateFilter = {
                        $gte: startOfDay,
                        $lt: new Date(now.setDate(now.getDate() + 1))
                    };
                    break;
                case 'weekly':
                    dateFilter = {
                        $gte: new Date(now.setDate(now.getDate() - 7)),
                        $lt: new Date()
                    };
                    break;
                case 'monthly':
                    dateFilter = {
                        $gte: new Date(now.setMonth(now.getMonth() - 1)),
                        $lt: new Date()
                    };
                    break;
                case 'custom':
                    if (startDate && endDate) {
                        dateFilter = {
                            $gte: new Date(startDate),
                            $lt: new Date(new Date(endDate).setDate(new Date(endDate).getDate() + 1))
                        };
                    }
                    break;
            }
        }

        // Apply date filter if any
        if (Object.keys(dateFilter).length > 0) {
            query['items.deliveredDate'] = dateFilter;
        }

        // Find orders and populate user data
        const orders = await Order.find(query).populate('userId');

        // Process orders to extract only delivered items
        const processedOrders = [];
        let totalRevenue = 0;

        for (const order of orders) {
            const userData = order.userId ? {
                name: order.userId.firstname && order.userId.lastname ? 
                    `${order.userId.firstname} ${order.userId.lastname}` : 
                    (order.userId.name || order.userId.email || 'Unknown User'),
                email: order.userId.email || 'N/A'
            } : { name: 'Unknown User', email: 'N/A' };

            // Filter for only delivered items
            const deliveredItems = order.items.filter(item => item.status === 'delivered');
            
            // Skip if no delivered items matching date criteria
            if (deliveredItems.length === 0) continue;

            // Process each delivered item
            for (const item of deliveredItems) {
                // Skip if date filter exists and item doesn't match
                if (Object.keys(dateFilter).length > 0 && 
                    (!item.deliveredDate || 
                     item.deliveredDate < dateFilter.$gte || 
                     item.deliveredDate >= dateFilter.$lt)) {
                    continue;
                }

                // Calculate item revenue (finalAmount includes all discounts)
                const itemRevenue = parseFloat(item.finalAmount || 0) + 
                                   parseFloat(item.gstAmount || 0) + 
                                   parseFloat(item.shippingCost || 0);
                
                totalRevenue += itemRevenue;

                processedOrders.push({
                    orderId: order.orderId,
                    itemId: item._id,
                    itemName: item.name,
                    userId: userData,
                    variantType: item.variantType,
                    quantity: item.quantity,
                    deliveredDate: item.deliveredDate,
                    amount: itemRevenue
                });
            }
        }

        // Sort by delivered date, most recent first
        processedOrders.sort((a, b) => {
            if (!a.deliveredDate) return 1;
            if (!b.deliveredDate) return -1;
            return new Date(b.deliveredDate) - new Date(a.deliveredDate);
        });

        // Pagination logic
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const totalItems = processedOrders.length;
        const totalPages = Math.ceil(totalItems / limit);
        const startIndex = (page - 1) * limit;
        const endIndex = Math.min(startIndex + limit, totalItems);
        const paginatedOrders = processedOrders.slice(startIndex, endIndex);

        console.log('Pagination data:', {
            page,
            totalItems,
            totalPages,
            processedOrdersLength: processedOrders.length,
            paginatedOrdersLength: paginatedOrders.length,
            hasItems: paginatedOrders.length > 0,
            filter
        });

        res.render('admin/sales-report', {
            orders: paginatedOrders,
            totalRevenue,
            currentFilter: filter || 'all',
            startDate,
            endDate,
            pagination: {
                currentPage: page,
                totalPages,
                totalItems,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
                nextPage: page + 1,
                prevPage: page - 1
            }
        });

    } catch (error) {
        console.error('Sales Report Error:', error);
        res.status(500).send('Error generating sales report');
    }
};

const downloadPDF = async (req, res) => {
    try {
        const { filter, startDate, endDate } = req.query;
        
        // Base query for delivered orders
        let query = {
            'items.status': 'delivered'
        };

        // Add date filtering
        if (filter) {
            const now = new Date();
            const startOfDay = new Date(now.setHours(0, 0, 0, 0));
            
            switch (filter) {
                case 'daily':
                    query.deliveryDate = {
                        $gte: startOfDay,
                        $lt: new Date(now.setDate(now.getDate() + 1))
                    };
                    break;
                case 'weekly':
                    query.deliveryDate = {
                        $gte: new Date(now.setDate(now.getDate() - 7)),
                        $lt: new Date()
                    };
                    break;
                case 'monthly':
                    query.deliveryDate = {
                        $gte: new Date(now.setMonth(now.getMonth() - 1)),
                        $lt: new Date()
                    };
                    break;
                case 'custom':
                    if (startDate && endDate) {
                        query.deliveryDate = {
                            $gte: new Date(startDate),
                            $lt: new Date(new Date(endDate).setDate(new Date(endDate).getDate() + 1))
                        };
                    }
                    break;
            }
        }

        const orders = await Order.find(query)
            .sort({ deliveryDate: -1 })
            .populate('userId', 'name email');

        // Create PDF document
        const doc = new PDFDocument({ margin: 30, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=sales-report.pdf');
        doc.pipe(res);

        // Add title with date range
        doc.fontSize(20).text('Sales Report', { align: 'center' });
        
        // Add date range subtitle
        let dateRangeText = 'All Time';
        if (filter === 'daily') {
            dateRangeText = new Date().toLocaleDateString();
        } else if (filter === 'weekly') {
            const weekStart = new Date(new Date().setDate(new Date().getDate() - 7));
            dateRangeText = `${weekStart.toLocaleDateString()} - ${new Date().toLocaleDateString()}`;
        } else if (filter === 'monthly') {
            const monthStart = new Date(new Date().setMonth(new Date().getMonth() - 1));
            dateRangeText = `${monthStart.toLocaleDateString()} - ${new Date().toLocaleDateString()}`;
        } else if (filter === 'custom' && startDate && endDate) {
            dateRangeText = `${new Date(startDate).toLocaleDateString()} - ${new Date(endDate).toLocaleDateString()}`;
        }
        
        doc.fontSize(12).text(`Period: ${dateRangeText}`, { align: 'center' });
        doc.moveDown();

        // Add table
        const table = {
            headers: ['Order ID', 'Customer', 'Date', 'Amount'],
            rows: orders.map(order => [
                order.orderId,
                order.userId.name,
                new Date(order.deliveryDate).toLocaleDateString(),
                `₹${order.totalAmount.toFixed(2)}`
            ])
        };

        await doc.table(table, {
            prepareHeader: () => doc.fontSize(10),
            prepareRow: () => doc.fontSize(10)
        });

        // Add total
        const totalRevenue = orders.reduce((sum, order) => sum + order.totalAmount, 0);
        doc.moveDown().fontSize(12).text(`Total Revenue: ₹${totalRevenue.toFixed(2)}`, { align: 'right' });

        doc.end();

    } catch (error) {
        console.error('PDF Download Error:', error);
        res.status(500).send('Error generating PDF');
    }
};

const downloadExcel = async (req, res) => {
    try {
        const { filter, startDate, endDate } = req.query;
        
        // Base query for delivered orders
        let query = {
            'items.status': 'delivered'
        };

        // Add date filtering
        if (filter) {
            const now = new Date();
            const startOfDay = new Date(now.setHours(0, 0, 0, 0));
            
            switch (filter) {
                case 'daily':
                    query.deliveryDate = {
                        $gte: startOfDay,
                        $lt: new Date(now.setDate(now.getDate() + 1))
                    };
                    break;
                case 'weekly':
                    query.deliveryDate = {
                        $gte: new Date(now.setDate(now.getDate() - 7)),
                        $lt: new Date()
                    };
                    break;
                case 'monthly':
                    query.deliveryDate = {
                        $gte: new Date(now.setMonth(now.getMonth() - 1)),
                        $lt: new Date()
                    };
                    break;
                case 'custom':
                    if (startDate && endDate) {
                        query.deliveryDate = {
                            $gte: new Date(startDate),
                            $lt: new Date(new Date(endDate).setDate(new Date(endDate).getDate() + 1))
                        };
                    }
                    break;
            }
        }

        const orders = await Order.find(query)
            .sort({ deliveryDate: -1 })
            .populate('userId', 'name email');

        // Create Excel workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Sales Report');

        // Add title and date range
        let dateRangeText = 'All Time';
        if (filter === 'daily') {
            dateRangeText = new Date().toLocaleDateString();
        } else if (filter === 'weekly') {
            const weekStart = new Date(new Date().setDate(new Date().getDate() - 7));
            dateRangeText = `${weekStart.toLocaleDateString()} - ${new Date().toLocaleDateString()}`;
        } else if (filter === 'monthly') {
            const monthStart = new Date(new Date().setMonth(new Date().getMonth() - 1));
            dateRangeText = `${monthStart.toLocaleDateString()} - ${new Date().toLocaleDateString()}`;
        } else if (filter === 'custom' && startDate && endDate) {
            dateRangeText = `${new Date(startDate).toLocaleDateString()} - ${new Date(endDate).toLocaleDateString()}`;
        }

        worksheet.addRow(['Sales Report']);
        worksheet.addRow([`Period: ${dateRangeText}`]);
        worksheet.addRow([]);  // Empty row for spacing

        // Add headers
        worksheet.columns = [
            { header: 'Order ID', key: 'orderId', width: 20 },
            { header: 'Customer Name', key: 'customerName', width: 20 },
            { header: 'Customer Email', key: 'customerEmail', width: 25 },
            { header: 'Date', key: 'date', width: 15 },
            { header: 'Amount', key: 'amount', width: 15 }
        ];

        // Add rows
        orders.forEach(order => {
            worksheet.addRow({
                orderId: order.orderId,
                customerName: order.userId.name,
                customerEmail: order.userId.email,
                date: new Date(order.deliveryDate).toLocaleDateString(),
                amount: order.totalAmount.toFixed(2)
            });
        });

        // Add total row
        const totalRevenue = orders.reduce((sum, order) => sum + order.totalAmount, 0);
        worksheet.addRow({});
        worksheet.addRow({
            orderId: 'Total Revenue:',
            amount: totalRevenue.toFixed(2)
        });

        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=sales-report.xlsx');

        // Write to response
        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('Excel Download Error:', error);
        res.status(500).send('Error generating Excel file');
    }
};

export default {
    getSalesReport,
    downloadPDF,
    downloadExcel
}; 