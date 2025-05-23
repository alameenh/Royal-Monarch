import Wallet from '../../model/walletModel.js';
import User from '../../model/userModel.js';
import Razorpay from 'razorpay';
import crypto from 'crypto';

// Debug log to check if environment variables are loaded
console.log('RAZORPAY_KEY_ID:', process.env.RAZORPAY_KEY_ID);
console.log('RAZORPAY_KEY_SECRET exists:', !!process.env.RAZORPAY_KEY_SECRET);

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

const walletController = {
    getWallet: async (req, res) => {
        try {
            const userId = req.session.userId;
            const user = await User.findById(userId);
            let wallet = await Wallet.findOne({ userId });
            
            if (!wallet) {
                wallet = await Wallet.create({
                    userId,
                    balance: 0,
                    transactions: []
                });
            }

            // Pagination logic
            const page = parseInt(req.query.page) || 1;
            const limit = 10;
            
            // Get total transactions count
            const totalTransactions = wallet.transactions.length;
            const totalPages = Math.ceil(totalTransactions / limit);
            
            // Get transactions for current page (slice in reverse order)
            const reversedTransactions = [...wallet.transactions].reverse();
            const startIndex = (page - 1) * limit;
            const endIndex = startIndex + limit;
            const paginatedTransactions = reversedTransactions.slice(startIndex, endIndex);
            
            // Pagination data
            const pagination = {
                currentPage: page,
                totalPages,
                totalTransactions,
                hasPrevPage: page > 1,
                hasNextPage: page < totalPages,
                prevPage: page - 1,
                nextPage: page + 1
            };

            res.render('user/wallet', {
                user,
                wallet: {
                    ...wallet.toObject(),
                    transactions: paginatedTransactions
                },
                pagination,
                currentPage: 'wallet',
                razorpayKeyId: process.env.RAZORPAY_KEY_ID
            });
        } catch (error) {
            console.error('Get Wallet Error:', error);
            res.redirect('/home');
        }
    },

    createOrder: async (req, res) => {
        try {
            const { amount } = req.body;
            
            // Debug logs
            console.log('Received amount:', amount);
            console.log('Razorpay instance:', !!razorpay);

            // Validate amount
            if (!amount || isNaN(amount)) {
                throw new Error('Invalid amount');
            }

            // Convert amount to rupees and check limit
            const amountInRupees = Number(amount) / 100;
            const MAX_AMOUNT = 100000; // Maximum amount limit of ₹1,00,000

            if (amountInRupees > MAX_AMOUNT) {
                return res.status(400).json({
                    success: false,
                    error: `Amount exceeds the maximum limit of ₹${MAX_AMOUNT.toLocaleString('en-IN')}`
                });
            }

            const options = {
                amount: Math.round(Number(amount)), // Ensure amount is a rounded number
                currency: "INR",
                receipt: `wallet_${Date.now()}`,
                payment_capture: 1
            };

            // Debug log
            console.log('Creating order with options:', options);

            const order = await razorpay.orders.create(options);
            
            // Debug log
            console.log('Order created:', order);

            res.status(200).json({
                success: true,
                order
            });
        } catch (error) {
            // Detailed error logging
            console.error('Create Order Error:', {
                message: error.message,
                stack: error.stack,
                details: error
            });

            res.status(500).json({
                success: false,
                error: error.message,
                details: process.env.NODE_ENV === 'development' ? error : undefined
            });
        }
    },

    verifyPayment: async (req, res) => {
        try {
            const {
                razorpay_payment_id,
                razorpay_order_id,
                razorpay_signature,
                amount
            } = req.body;

            // Verify signature
            const sign = razorpay_order_id + "|" + razorpay_payment_id;
            const expectedSign = crypto
                .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
                .update(sign.toString())
                .digest("hex");

            if (razorpay_signature === expectedSign) {
                const userId = req.session.userId;
                const wallet = await Wallet.findOne({ userId });
                const amountInRupees = Number(amount) / 100;

                // Update wallet balance
                wallet.balance += amountInRupees;
                wallet.transactions.push({
                    transactionId: razorpay_payment_id,
                    type: 'CREDIT',
                    amount: amountInRupees,
                    description: 'Wallet Recharge',
                    date: new Date()
                });

                await wallet.save();

                res.json({
                    success: true,
                    message: "Payment verified successfully"
                });
            } else {
                throw new Error("Invalid signature");
            }
        } catch (error) {
            console.error('Verify Payment Error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
};

export default walletController; 