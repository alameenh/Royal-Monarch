import Product from '../../model/productModel.js';
import Category from '../../model/categoryModel.js';
import Offer from '../../model/offerModel.js';
import mongoose from 'mongoose';
import User from '../../model/userModel.js';
import Wallet from '../../model/walletModel.js';
import Address from '../../model/addressModel.js';
import CartItem from '../../model/cartModel.js';
import Coupon from '../../model/couponModel.js';
import Order from '../../model/orderModel.js';
import { v4 as uuidv4 } from 'uuid';
import razorpay, { verifyRazorpayConfig } from '../../utils/razorpay.js';

const getShopPage = async (req, res) => {
    try {
        // Get all categories
        const categories = await Category.find({ status: 'Active' });
        
        // Get cart count for navbar
        const userId = req.session.userId;
        const cartCount = await CartItem.countDocuments({ userId });

        // Get category filter from URL if present
        const categoryFilter = req.query.category || '';
        
        res.render('user/shop', { 
            categories,
            cartCount,
            initialCategory: categoryFilter // Pass the category filter to the view
        });
    } catch (error) {
        console.error('Shop Page Error:', error);
        res.status(500).json({ success: false, message: 'Error loading shop page' });
    }
};

const getProducts = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 12;
        const search = req.query.search || '';
        const category = req.query.category || '';
        const sortBy = req.query.sortBy || 'createdAt';
        const order = req.query.order || 'desc';
        const minPrice = req.query.minPrice ? parseFloat(req.query.minPrice) : 0;
        const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice) : Number.MAX_SAFE_INTEGER;

        // Get current date for offer validation
        const currentDate = new Date();

        // Fetch active offers
        const activeOffers = await Offer.find({
            isActive: true,
            startDate: { $lte: currentDate },
            endDate: { $gte: currentDate }
        });

        // Build base query
        let query = { status: 'Active' };

        // Add search conditions
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { brand: { $regex: search, $options: 'i' } }
            ];
        }

        // Add category filter
        if (category) {
            query.category = new mongoose.Types.ObjectId(category);
        }

        // First get all products without price filtering
        const products = await Product.aggregate([
            {
                $lookup: {
                    from: 'categories',
                    localField: 'category',
                    foreignField: '_id',
                    as: 'categoryData'
                }
            },
            {
                $unwind: '$categoryData'
            },
            {
                $match: {
                    ...query,
                    'categoryData.status': 'Active'
                }
            }
        ]);

        // Process products to include offer information and calculate final prices
        const processedProducts = products.map(product => {
            // Find product-specific offer
            const productOffer = activeOffers.find(offer => 
                offer.type === 'product' && 
                offer.productIds.some(id => id.toString() === product._id.toString())
            );

            // Find category offer
            const categoryOffer = activeOffers.find(offer => 
                offer.type === 'category' && 
                offer.categoryId.toString() === product.category.toString()
            );

            // Use product offer if available, otherwise use category offer
            const applicableOffer = productOffer || categoryOffer;

            // Calculate discounted price for the base variant
            const baseVariant = product.variants[0];
            const originalPrice = baseVariant.price;
            const discountedPrice = applicableOffer 
                ? Math.round(originalPrice * (1 - applicableOffer.discount/100))
                : originalPrice;

            return {
                ...product,
                offer: applicableOffer,
                discountedPrice,
                originalPrice
            };
        });

        // Apply price filtering after calculating discounted prices
        const filteredProducts = processedProducts.filter(product => {
            const price = product.discountedPrice;
            return price >= minPrice && price <= maxPrice;
        });

        // Apply sorting after filtering
        let sortedProducts = [...filteredProducts];
        if (sortBy === 'price') {
            sortedProducts.sort((a, b) => {
                const priceA = a.discountedPrice;
                const priceB = b.discountedPrice;
                if (priceA === priceB) {
                    return a.name.localeCompare(b.name);
                }
                if (order === 'desc') {
                    return priceB - priceA; // High to low
                } else {
                    return priceA - priceB; // Low to high
                }
            });
        } else {
            sortedProducts.sort((a, b) => {
                if (sortBy === 'name') {
                    return order === 'desc' 
                        ? b.name.localeCompare(a.name)
                        : a.name.localeCompare(b.name);
                } else {
                    return order === 'desc' 
                        ? new Date(b[sortBy]) - new Date(a[sortBy])
                        : new Date(a[sortBy]) - new Date(b[sortBy]);
                }
            });
        }

        // Apply pagination
        const totalProducts = sortedProducts.length;
        const totalPages = Math.ceil(totalProducts / limit);
        const paginatedProducts = sortedProducts.slice((page - 1) * limit, page * limit);

        res.json({
            success: true,
            products: paginatedProducts,
            pagination: {
                currentPage: page,
                totalPages,
                totalProducts,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
        });

    } catch (error) {
        console.error('Get Products Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching products'
        });
    }
};

const getProductDetails = async (req, res) => {
    try {
        const productId = req.params.productId;
        const product = await Product.findOne({ 
            _id: productId, 
            status: 'Active' 
        }).populate('category');

        if (!product) {
            return res.status(404).render('error', { 
                message: 'Product not found' 
            });
        }

        // Get similar products from same category
        const similarProducts = await Product.find({
            category: product.category._id,
            _id: { $ne: product._id },
            status: 'Active'
        })
        .limit(4);

        res.render('user/product', { 
            product, 
            similarProducts 
        });

    } catch (error) {
        console.error('Product Details Error:', error);
        res.status(500).render('error', { 
            message: 'Error loading product details' 
        });
    }
};

const getCategories = async (req, res) => {
    try {
        const categories = await Category.find({ 
            status: 'Active' 
        });

        res.json({
            success: true,
            categories
        });

    } catch (error) {
        console.error('Get Categories Error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching categories' 
        });
    }
};

const getCheckout = async (req, res) => {
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
        const activeCoupons = await Coupon.find({
            isActive: true,
            startDate: { $lte: new Date() },
            endDate: { $gte: new Date() }
        }).lean();

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
                ...item.toObject(),
                originalPrice,
                priceAfterOffer,
                offer: applicableOffer,
                offerDiscountforproduct: offerDiscount * item.quantity,
                subtotalAfterOffer,
                gstAmount: itemGstAmount * item.quantity,
                shippingCost: itemShippingCost * item.quantity,
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
                originalSubtotal += item.originalPrice * item.quantity;
                totalOfferDiscount += item.offerDiscountforproduct;
                totalSubtotalAfterOffers += item.subtotalAfterOffer;
                totalGstAmount += item.gstAmount;
                totalShippingCost += item.shippingCost;
            }
        });

        // Calculate final total
        const total = totalSubtotalAfterOffers + totalGstAmount + totalShippingCost;

        // Get cart count for the navbar
        const cartCount = await CartItem.countDocuments({ userId });

        res.render('user/checkout', {
            title: 'Checkout',
            user: await User.findById(userId),
            cartItems: processedCartItems,
            originalSubtotal,
            totalOfferDiscount,
            subtotal: totalSubtotalAfterOffers,
            gstAmount: totalGstAmount,
            shippingCost: totalShippingCost,
            total,
            currentPage: 'checkout',
            cartCount,
            walletBalance,
            coupons: activeCoupons,
            appliedCoupon: null // Initialize as null since no coupon is applied initially
        });

    } catch (error) {
        console.error('Checkout Error:', error);
        res.status(500).render('error', {
            message: 'Error loading checkout page'
        });
    }
};

const createOrder = async (req, res) => {
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
                const itemTotal = (priceAfterOffer + itemGstAmount + itemShippingCost) * item.quantity;

                // Update stock
                variant.stock -= item.quantity;
                await product.save({ session });

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
                    subtotalforproduct: priceAfterOffer * item.quantity
                });

                totalAmount += itemTotal;
                totalGstAmount += itemGstAmount * item.quantity;
                totalShippingCost += itemShippingCost * item.quantity;
            }

            // Validate total amount matches client calculation
            if (Math.abs(totalAmount - clientTotalAmount) > 1) {
                throw new Error('Total amount mismatch');
            }

            // Create order
            const newOrderId = uuidv4();
            const order = new Order({
                orderId: newOrderId,
                userId,
                items: orderItems,
                totalAmount,
                originalSubtotal,
                totalOfferDiscount,
                totalCouponDiscount,
                subtotal: totalAmount - totalGstAmount - totalShippingCost,
                gstAmount: totalGstAmount,
                shippingCost: totalShippingCost,
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
                    discount: totalCouponDiscount,
                    type: coupon.type
                } : null
            });

            await order.save({ session });

            // Update coupon usage if applied
            if (coupon && coupon.id) {
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
                    },
                    { session }
                );
            }

            // Handle payment based on method
            if (paymentMethod === 'cod') {
                order.paymentStatus = 'unpaid';
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
                        amount: Math.round(totalAmount * 100),
                        currency: "INR",
                        receipt: order.orderId,
                        payment_capture: 1,
                        notes: {
                            orderId: order.orderId,
                            userId: userId.toString(),
                            subtotal: order.subtotal,
                            offerDiscount: totalOfferDiscount,
                            couponDiscount: totalCouponDiscount,
                            gst: totalGstAmount,
                            shipping: totalShippingCost,
                            finalAmount: totalAmount
                        }
                    };

                    const razorpayOrder = await razorpay.orders.create(options);
                    if (!razorpayOrder || !razorpayOrder.id) {
                        throw new Error('Failed to create Razorpay order');
                    }

                    order.paymentDetails = {
                        razorpayOrderId: razorpayOrder.id
                    };
                    await order.save({ session });
                    await CartItem.deleteMany({ userId }).session(session);
                    await session.commitTransaction();

                    return res.json({
                        success: true,
                        message: 'Order created',
                        orderId: order.orderId,
                        paymentMethod,
                        razorpayOrder: {
                            id: razorpayOrder.id,
                            amount: Math.round(totalAmount * 100),
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
                const wallet = await Wallet.findOne({ userId }).session(session);
                if (!wallet || wallet.balance < totalAmount) {
                    throw new Error('Insufficient wallet balance');
                }

                wallet.balance -= totalAmount;
                wallet.transactions.push({
                    transactionId: uuidv4(),
                    type: 'DEBIT',
                    amount: totalAmount,
                    description: `Payment for order ${newOrderId}`,
                    date: new Date()
                });
                await wallet.save({ session });

                order.paymentStatus = 'paid';
                await order.save({ session });
                await CartItem.deleteMany({ userId }).session(session);
                await session.commitTransaction();

                return res.json({
                    success: true,
                    paymentMethod: 'wallet',
                    redirect: `/order/success/${newOrderId}`
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
};

const retryPayment = async (req, res) => {
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
};

const getPaymentFailed = async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const order = await Order.findOne({ orderId });
        
        if (!order) {
            return res.redirect('/orders');
        }

        res.render('user/paymentFailed', {
            orderId: order.orderId,
            user: req.user
        });
    } catch (error) {
        console.error('Error in payment failed controller:', error);
        res.redirect('/orders');
    }
};

export default { 
    getShopPage, 
    getProducts, 
    getProductDetails, 
    getCategories, 
    getCheckout, 
    createOrder,
    retryPayment,
    getPaymentFailed
};
