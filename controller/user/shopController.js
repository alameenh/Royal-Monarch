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
import razorpay from '../../utils/razorpay.js';

const getShopPage = async (req, res) => {
    try {
        // Get all categories
        const categories = await Category.find({ status: 'Active' });
        
        // Get cart count for navbar
        const userId = req.session.userId;
        const cartCount = await CartItem.countDocuments({ userId });
        
        res.render('user/shop', { 
            categories,
            cartCount 
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
        const minPrice = req.query.minPrice ? parseInt(req.query.minPrice) : 0;
        const maxPrice = req.query.maxPrice ? parseInt(req.query.maxPrice) : Number.MAX_SAFE_INTEGER;

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

        // Add price filter
        if (minPrice || maxPrice) {
            query['variants.0.price'] = { 
                $gte: minPrice, 
                $lte: maxPrice 
            };
        }

        // Add search conditions
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { brand: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        // Add category filter
        if (category) {
            query.category = new mongoose.Types.ObjectId(category);
        }

        // Build sort configuration
        let sortConfig = {};
        if (sortBy === 'price') {
            sortConfig['variants.0.price'] = order === 'desc' ? -1 : 1;
        } else {
            sortConfig[sortBy] = order === 'desc' ? -1 : 1;
        }

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
            },
            {
                $sort: sortConfig
            },
            {
                $skip: (page - 1) * limit
            },
            {
                $limit: limit
            }
        ]);

        // Process products to include offer information
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
                originalPrice,
                variants: product.variants.map(variant => ({
                    type: variant.type,
                    price: variant.price,
                    stock: variant.stock,
                    specifications: variant.specifications || []
                }))
            };
        });

        // Get total count
        const totalProducts = await Product.aggregate([
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
            },
            {
                $count: 'total'
            }
        ]);

        const total = totalProducts[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        res.json({
            success: true,
            products: processedProducts,
            pagination: {
                currentPage: page,
                totalPages,
                totalProducts: total,
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

        let subtotal = 0;
        let totalOfferDiscount = 0;
        let originalSubtotal = 0;

        // Process each cart item with offers and calculate prices
        const processedCartItems = cartItems.map(item => {
            if (!item.productId || item.productId.status !== 'Active') return null;

            const variant = item.productId.variants.find(v => v.type === item.variantType);
            const originalPrice = variant.price;
            
            // First check for product offer
            const productOffer = activeOffers.find(offer => 
                offer.type === 'product' && 
                offer.productIds.some(id => id.toString() === item.productId._id.toString())
            );

            // Then check for category offer
            const categoryOffer = activeOffers.find(offer => 
                offer.type === 'category' && 
                offer.categoryId.toString() === item.productId.category.toString()
            );

            // Apply product offer if available, otherwise use category offer
            const applicableOffer = productOffer || categoryOffer;
            let offerDiscount = 0;
            let discountedPrice = originalPrice;

            if (applicableOffer) {
                offerDiscount = (originalPrice * applicableOffer.discount) / 100;
                discountedPrice = originalPrice - offerDiscount;
                totalOfferDiscount += offerDiscount * item.quantity;
            }

            originalSubtotal += originalPrice * item.quantity;
            subtotal += originalPrice * item.quantity;

            return {
                ...item,
                originalPrice,
                discountedPrice,
                totalPrice: discountedPrice * item.quantity,
                offer: applicableOffer ? {
                    name: applicableOffer.name,
                    type: applicableOffer.type,
                    discount: applicableOffer.discount
                } : null
            };
        }).filter(Boolean);

        // Calculate total subtotal after offers
        const subtotalAfterOffers = processedCartItems.reduce((sum, item) => sum + item.totalPrice, 0);

        // Calculate GST and shipping based on subtotal after offers (will be updated if coupon is applied)
        const gstAmount = Math.round(subtotalAfterOffers * 0.18);
        const shippingCost = subtotalAfterOffers > 0 ? Math.round(subtotalAfterOffers * 0.02) : 0;
        
        // Calculate final total
        const total = subtotalAfterOffers + gstAmount + shippingCost;

        // Fetch eligible coupons
        const validCoupons = await Coupon.find({
            isActive: true,
            startDate: { $lte: new Date() },
            expiryDate: { $gte: new Date() },
            minPurchase: { $lte: subtotalAfterOffers }
        }).lean();

        const eligibleCoupons = validCoupons.filter(coupon => {
            const userUsage = coupon.usageHistory.filter(
                history => history.userId.toString() === userId.toString()
            ).length;
            return userUsage < coupon.usageLimit;
        });

        res.render('user/checkout', {
            title: 'Checkout',
            user,
            cartItems: processedCartItems,
            addresses,
            originalSubtotal,
            subtotal: subtotalAfterOffers,
            totalOfferDiscount,
            gstAmount,
            shippingCost,
            total,
            coupons: eligibleCoupons,
            walletBalance,
            razorpayKey: process.env.RAZORPAY_KEY_ID,
            currentPage: 'checkout'
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
        console.log('Order creation started');
        const userId = req.session.userId;
        const { addressId, paymentMethod, coupon, totalAmount, items: clientItems, originalSubtotal, totalOfferDiscount, totalCouponDiscount } = req.body;
        
        console.log('Received data:', { 
            addressId, 
            paymentMethod, 
            coupon, 
            totalAmount,
            originalSubtotal,
            totalOfferDiscount,
            totalCouponDiscount,
            itemsCount: clientItems ? clientItems.length : 0
        });

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

        // Stock check before order creation
        for (const item of cartItems) {
            const product = await Product.findById(item.productId._id);
            if (!product) {
                throw new Error(`Product ${item.productId._id} not found`);
            }

            const variant = product.variants.find(v => v.type === item.variantType);
            if (!variant) {
                throw new Error(`Variant ${item.variantType} not found for ${product.name}`);
            }

            if (variant.stock < item.quantity) {
                throw new Error(`Insufficient stock for ${product.name} (${item.variantType})`);
            }

            // Decrease stock
            variant.stock -= item.quantity;
            await product.save();
        }

        // If we received processed items from the client, use them directly
        let orderItems = [];
        if (clientItems && clientItems.length > 0) {
            console.log('Using client-side processed items');
            orderItems = clientItems.map(item => {
                // Ensure all required fields are set correctly
                return {
                    productId: item.productId,
                    name: item.name,
                    brand: item.brand,
                    category: item.category,
                    images: item.images,
                    quantity: item.quantity,
                    originalPrice: item.originalPrice,
                    variantType: item.variantType,
                    status: 'pending',
                    previousStatus: 'pending',
                    offer: item.offer,
                    offerDiscount: item.offerDiscount || 0,
                    priceAfterOffer: item.priceAfterOffer,
                    couponForProduct: item.couponForProduct || null,
                    couponDiscount: item.couponDiscount || 0,
                    subtotalforproduct: item.subtotalforproduct,
                    finalPrice: item.finalPrice,
                    finalAmount: item.finalAmount,
                    gstAmount: item.gstAmount,
                    shippingCost: item.shippingCost
                };
            });
        } else {
            // Otherwise, calculate all values server-side
            console.log('Calculating item details on server-side');
            // Fetch active offers
            const activeOffers = await Offer.find({
                isActive: true,
                startDate: { $lte: new Date() },
                endDate: { $gte: new Date() }
            });

            let calculatedOriginalSubtotal = 0;
            let calculatedTotalOfferDiscount = 0;

            // Process each cart item
            for (const item of cartItems) {
                if (!item.productId || item.productId.status !== 'Active') continue;

                const variant = item.productId.variants.find(v => v.type === item.variantType);
                const originalPrice = variant.price;
                
                // Find applicable offers
                const productOffer = activeOffers.find(offer => 
                    offer.type === 'product' && 
                    offer.productIds.some(id => id.toString() === item.productId._id.toString())
                );

                const categoryOffer = activeOffers.find(offer => 
                    offer.type === 'category' && 
                    offer.categoryId.toString() === item.productId.category.toString()
                );

                // Apply best offer
                const applicableOffer = productOffer || categoryOffer;
                let offerDiscount = 0;
                let priceAfterOffer = originalPrice;

                if (applicableOffer) {
                    offerDiscount = (originalPrice * applicableOffer.discount) / 100;
                    priceAfterOffer = originalPrice - offerDiscount;
                    calculatedTotalOfferDiscount += offerDiscount * item.quantity;
                }

                // Calculate subtotal for this product after offer
                const subtotalAfterOffer = priceAfterOffer * item.quantity;
                calculatedOriginalSubtotal += originalPrice * item.quantity;

                // Calculate GST and shipping for this item
                const itemGstAmount = Math.round(subtotalAfterOffer * 0.18);
                const itemShippingCost = Math.round(subtotalAfterOffer * 0.02);

                // Create order item with all required fields
                const orderItem = {
                    productId: item.productId._id,
                    name: item.productId.name,
                    brand: item.productId.brand,
                    category: item.productId.category,
                    images: item.productId.images,
                    quantity: item.quantity,
                    originalPrice: originalPrice,
                    variantType: item.variantType,
                    status: 'pending',
                    previousStatus: 'pending',
                    offer: applicableOffer ? {
                        name: applicableOffer.name,
                        type: applicableOffer.type,
                        discount: applicableOffer.discount
                    } : null,
                    offerDiscount: offerDiscount,
                    priceAfterOffer: priceAfterOffer,
                    subtotalforproduct: subtotalAfterOffer,
                    finalPrice: priceAfterOffer,
                    finalAmount: subtotalAfterOffer,
                    gstAmount: itemGstAmount,
                    shippingCost: itemShippingCost,
                    couponForProduct: null,
                    couponDiscount: 0
                };

                orderItems.push(orderItem);
            }

            // Use the calculated values if client didn't provide them
            originalSubtotal = originalSubtotal || calculatedOriginalSubtotal;
            totalOfferDiscount = totalOfferDiscount || calculatedTotalOfferDiscount;
        }

        // Calculate subtotal after offers
        const subtotalAfterOffers = originalSubtotal - totalOfferDiscount;

        // Apply coupon if provided
        let couponDetails = null;
        if (coupon) {
            // Verify coupon is still valid
            const validCoupon = await Coupon.findOne({
                _id: coupon.id,
                isActive: true,
                startDate: { $lte: new Date() },
                expiryDate: { $gte: new Date() },
                minPurchase: { $lte: subtotalAfterOffers }
            });

            if (!validCoupon) {
                throw new Error('Coupon is no longer valid');
            }

            couponDetails = {
                code: validCoupon.code,
                discount: totalCouponDiscount,
                type: validCoupon.discountType
            };

            // If client-side coupon calculation hasn't been done
            if (!clientItems || !clientItems.some(item => item.couponDiscount > 0)) {
                // Calculate total coupon discount
                let calculatedCouponDiscount;
                if (validCoupon.discountType === 'PERCENTAGE') {
                    calculatedCouponDiscount = (subtotalAfterOffers * validCoupon.discountValue) / 100;
                    if (validCoupon.maxDiscount && calculatedCouponDiscount > validCoupon.maxDiscount) {
                        calculatedCouponDiscount = validCoupon.maxDiscount;
                    }
                } else {
                    // For fixed amount coupons
                    calculatedCouponDiscount = validCoupon.discountValue;
                }

                // Calculate proportion of each product in the total
                const totalSubtotalAfterOffers = orderItems.reduce((sum, item) => sum + item.subtotalforproduct, 0);
                
                // Distribute coupon discount across products
                orderItems.forEach(item => {
                    const proportion = item.subtotalforproduct / totalSubtotalAfterOffers;
                    let couponDiscount;
                    
                    if (validCoupon.discountType === 'PERCENTAGE') {
                        couponDiscount = (item.subtotalforproduct * validCoupon.discountValue) / 100;
                        if (validCoupon.maxDiscount) {
                            couponDiscount = Math.min(couponDiscount, validCoupon.maxDiscount * proportion);
                        }
                    } else {
                        // For fixed amount, distribute evenly based on proportion
                        couponDiscount = calculatedCouponDiscount * proportion;
                    }

                    item.couponForProduct = {
                        code: validCoupon.code,
                        discount: couponDiscount,
                        type: validCoupon.discountType
                    };
                    item.couponDiscount = couponDiscount;
                    item.finalPrice = item.priceAfterOffer - (couponDiscount / item.quantity);
                    item.finalAmount = item.finalPrice * item.quantity;
                });

                // Use calculated value if client didn't provide it
                totalCouponDiscount = totalCouponDiscount || calculatedCouponDiscount;
            }
        } else {
            // If no coupon, ensure final prices same as price after offer
            orderItems.forEach(item => {
                item.finalPrice = item.priceAfterOffer;
                item.finalAmount = item.finalPrice * item.quantity;
            });
        }

        // Calculate final amounts and update order items if needed
        const subtotalAfterCoupon = orderItems.reduce((sum, item) => sum + item.finalAmount, 0);
        const gstAmount = Math.round(subtotalAfterCoupon * 0.18);
        const shippingCost = subtotalAfterCoupon > 0 ? Math.round(subtotalAfterCoupon * 0.02) : 0;
        const finalAmount = subtotalAfterCoupon + gstAmount + shippingCost;

        // Create order
        const newOrderId = uuidv4();
        const order = new Order({
            orderId: newOrderId,
            userId,
            items: orderItems,
            totalAmount: finalAmount,
            originalSubtotal,
            totalOfferDiscount,
            totalCouponDiscount,
            subtotal: subtotalAfterOffers,
            gstAmount,
            shippingCost,
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
            coupon: couponDetails
        });

        await order.save();
        console.log('Order saved successfully:', order.orderId);

        // Update coupon usage after order is created
        if (coupon && couponDetails) {
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
                }
            );
        }

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
                console.log('Creating Razorpay order');
                verifyRazorpayConfig();

                const options = {
                    amount: Math.round(totalAmount * 100),
                    currency: "INR",
                    receipt: order.orderId,
                    notes: {
                        orderId: order.orderId,
                        userId: userId.toString(),
                        subtotal: subtotalAfterOffers,
                        offerDiscount: totalOfferDiscount,
                        couponDiscount: totalCouponDiscount,
                        gst: gstAmount,
                        shipping: shippingCost,
                        finalAmount: totalAmount
                    }
                };

                const razorpayOrder = await razorpay.orders.create(options);

                if (!razorpayOrder || !razorpayOrder.id) {
                    throw new Error('Failed to create Razorpay order');
                }

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
                        amount: Math.round(totalAmount * 100),
                        currency: 'INR'
                    }
                });
            } catch (razorpayError) {
                console.error('Razorpay Order Creation Error:', razorpayError);
                await Order.findByIdAndDelete(order._id);
                throw new Error(razorpayError.error?.description || razorpayError.message || 'Failed to create payment order');
            }
        }
        else if (paymentMethod === 'wallet') {
            // Check wallet balance
            const wallet = await Wallet.findOne({ userId });
            if (!wallet || wallet.balance < finalAmount) {
                return res.status(400).json({
                    success: false,
                    message: 'Insufficient wallet balance'
                });
            }

            // Deduct amount from wallet
            wallet.balance -= finalAmount;
            wallet.transactions.push({
                transactionId: uuidv4(),
                type: 'DEBIT',
                amount: finalAmount,
                description: `Payment for order ${newOrderId}`,
                date: new Date()
            });
            await wallet.save();

            // Update order payment status
            order.paymentStatus = 'paid';
            await order.save();

            // Clear cart
            await CartItem.deleteMany({ userId });

            return res.json({
                success: true,
                paymentMethod: 'wallet',
                redirect: `/order/success/${newOrderId}`
            });
        }

    } catch (error) {
        console.error('Create Order Error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create order'
        });
    }
};

export default { 
    getShopPage, 
    getProducts, 
    getProductDetails, 
    getCategories, 
    getCheckout, 
    createOrder 
};
