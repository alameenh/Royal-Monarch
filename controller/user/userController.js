import nodemailer from 'nodemailer';
import userModel from '../../model/userModel.js';
import { config } from 'dotenv';
import bcrypt from 'bcryptjs';
import Category from '../../model/categoryModel.js';
import Product from '../../model/productModel.js';
import passport from 'passport';
import CartItem from '../../model/cartModel.js';
import Offer from '../../model/offerModel.js';
import HomeSettings from '../../model/homeSettingsModel.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import Wishlist from '../../model/wishlistModel.js';

config();

const getLogin = (req, res) => {
    if (req.session.isAuth) {
        return res.redirect('/home');
    }
    res.render('user/login.ejs');
}

const getSignup = (req, res) => {
    try {
        // Check if user is already logged in
        if (req.session.isLoggedIn) {
            return res.redirect('/home');
        }
        // Render signup page with any necessary data
        res.render('user/signup', {
            title: 'Sign Up',
            error: null
        });
    } catch (error) {
        console.error('Error rendering signup page:', error);
        res.status(500).render('error', {
            message: 'Error loading signup page'
        });
    }
};

const postSignup = async (req, res) => {
    try {
        const { firstName, lastName, email, password, confirmPassword } = req.body;

        // Trim and validate input data
        const trimmedFirstName = firstName?.trim();
        const trimmedLastName = lastName?.trim();
        const trimmedEmail = email?.trim();

        // Validate required fields
        if (!trimmedFirstName || !trimmedLastName || !trimmedEmail || !password || !confirmPassword) {
            return res.status(400).json({ 
                success: false, 
                message: 'Please fill in all required fields' 
            });
        }

        // Validate name lengths and characters
        if (trimmedFirstName.length < 2 || trimmedFirstName.length > 50) {
            return res.status(400).json({
                success: false,
                message: 'First name must be between 2 and 50 characters'
            });
        }

        if (!/^[a-zA-Z\s]+$/.test(trimmedFirstName)) {
            return res.status(400).json({
                success: false,
                message: 'First name should only contain letters'
            });
        }

        if (trimmedLastName.length < 2 || trimmedLastName.length > 50) {
            return res.status(400).json({
                success: false,
                message: 'Last name must be between 2 and 50 characters'
            });
        }

        if (!/^[a-zA-Z\s]+$/.test(trimmedLastName)) {
            return res.status(400).json({
                success: false,
                message: 'Last name should only contain letters'
            });
        }

        // Validate email format and length
        if (trimmedEmail.length > 100) {
            return res.status(400).json({
                success: false,
                message: 'Email must be less than 100 characters'
            });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(trimmedEmail)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email address'
            });
        }

        // Validate password
        if (password.length < 8 || password.length > 50) {
            return res.status(400).json({
                success: false,
                message: 'Password must be between 8 and 50 characters'
            });
        }

        if (!/[A-Z]/.test(password)) {
            return res.status(400).json({
                success: false,
                message: 'Password must contain at least one uppercase letter'
            });
        }

        if (!/[a-z]/.test(password)) {
            return res.status(400).json({
                success: false,
                message: 'Password must contain at least one lowercase letter'
            });
        }

        if (!/[0-9]/.test(password)) {
            return res.status(400).json({
                success: false,
                message: 'Password must contain at least one number'
            });
        }

        if (!/[!@#$%^&*]/.test(password)) {
            return res.status(400).json({
                success: false,
                message: 'Password must contain at least one special character (!@#$%^&*)'
            });
        }

        // Validate password confirmation
        if (password !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'Passwords do not match'
            });
        }

        // Check if user already exists
        let existingUser = await userModel.findOne({ email: trimmedEmail });
        
        // If user exists and is pending, delete it
        if (existingUser && existingUser.status === 'Pending') {
            await userModel.deleteOne({ email: trimmedEmail });
            existingUser = null;
        }

        // If user exists and is active
        if (existingUser) {
            // If user has Google ID, update with password
            if (existingUser.googleId) {
                const salt = await bcrypt.genSalt(10);
                const hashedPassword = await bcrypt.hash(password, salt);
                
                await userModel.findByIdAndUpdate(existingUser._id, {
                    password: hashedPassword
                });

                // Generate OTP for verification
                const otpValue = Math.floor(100000 + Math.random() * 900000).toString();
                const twoMinutes = 2 * 60 * 1000;
                const thirtySeconds = 30 * 1000;
                const otpExpiryTime = new Date(Date.now() + twoMinutes);
                const resendTimer = new Date(Date.now() + thirtySeconds);

                await userModel.findByIdAndUpdate(existingUser._id, {
                    otp: {
                        otpValue,
                        otpExpiresAt: otpExpiryTime,
                        otpAttempts: 0,
                        resendTimer: resendTimer
                    }
                });

                // Send OTP email
                const transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: {
                        user: process.env.EMAIL_USER,
                        pass: process.env.EMAIL_PASS,
                    },
                    tls: {
                        rejectUnauthorized: false,
                    },
                });

                const mailOptions = {
                    from: process.env.EMAIL_USER,
                    to: trimmedEmail,
                    subject: 'Your OTP Code',
                    text: `Your OTP code is ${otpValue}`,
                    html: `
                        <h2>Welcome to Royal Monarch!</h2>
                        <p>Your OTP code is: <strong>${otpValue}</strong></p>
                        <p>This OTP will expire in 2 minutes.</p>
                        <p>If you didn't request this, please ignore this email.</p>
                    `
                };

                await transporter.sendMail(mailOptions);

                // Set session data for OTP verification
                req.session.email = trimmedEmail;
                req.session.otpExpiresAt = otpExpiryTime;

                return res.json({ 
                    success: true, 
                    message: 'Password added to your account! Please verify with OTP.',
                    redirect: '/otpPage'
                });
            }

            return res.status(400).json({ 
                success: false, 
                message: 'This email is already registered. Please use a different email or try logging in.' 
            });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Generate OTP
        const otpValue = Math.floor(100000 + Math.random() * 900000).toString();
        const twoMinutes = 2 * 60 * 1000; // OTP expires in 2 minutes
        const thirtySeconds = 30 * 1000; // Resend cooldown is 30 seconds
        const otpExpiryTime = new Date(Date.now() + twoMinutes);
        const resendTimer = new Date(Date.now() + thirtySeconds);

        // Create new user
        const newUser = new userModel({
            firstname: trimmedFirstName,
            lastname: trimmedLastName,
            email: trimmedEmail,
            password: hashedPassword,
            status: 'Pending',
            otp: {
                otpValue,
                otpExpiresAt: otpExpiryTime,
                otpAttempts: 0,
                resendTimer: resendTimer
            },
        });

        await newUser.save();

        // Send OTP email
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
            tls: {
                rejectUnauthorized: false,
            },
        });

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: trimmedEmail,
            subject: 'Your OTP Code',
            text: `Your OTP code is ${otpValue}`,
            html: `
                <h2>Welcome to Royal Monarch!</h2>
                <p>Your OTP code is: <strong>${otpValue}</strong></p>
                <p>This OTP will expire in 2 minutes.</p>
                <p>If you didn't request this, please ignore this email.</p>
            `
        };

        await transporter.sendMail(mailOptions);

        // Set session data for OTP verification
        req.session.email = trimmedEmail;
        req.session.otpExpiresAt = otpExpiryTime;

        res.json({ 
            success: true, 
            message: 'Account created successfully! Please check your email for the OTP code.',
            redirect: '/otpPage'
        });

    } catch (error) {
        console.error('Signup Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Something went wrong. Please try again later.'
        });
    }
};

const verifyOtp = async (req, res) => {
    const { otp } = req.body;
    const user = await userModel.findOne({ email: req.session.email });
    console.log("user",user);
    
    if (!user) {
        return res.status(400).json({ success: false, message: 'User not found. Please sign up again.' });
    }

    if (user.otp.otpAttempts >= 3 || new Date() > user.otp.otpExpiresAt) {
        await userModel.deleteOne({ email: req.session.email });
        return res.status(400).json({ success: false, message: 'OTP expired or too many attempts. Please sign up again.' });
    }

    if (user.otp.otpValue === otp) {
        user.status = 'Active';
        user.otp = null; 
        req.session.userId = user._id;
        req.session.email = user.email;
        req.session.isLoggedIn = true;
        await user.save();
        return res.json({ success: true, message: 'OTP verified successfully' });
    } else {
        user.otp.otpAttempts += 1;
        await user.save();
        if (user.otp.otpAttempts >= 3) {
            await userModel.deleteOne({ email: req.session.email });
            return res.status(400).json({ success: false, message: 'Too many attempts. Please sign up again.' });
        }
        return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }
};

const getOtpPage = async (req, res) => {
    try {
        if (!req.session.email) {
            return res.redirect('/signup');
        }

        const user = await userModel.findOne({ email: req.session.email });
        if (!user) {
            req.session.destroy();
            return res.redirect('/signup');
        }

        // Check if OTP exists
        if (!user.otp) {
            req.session.destroy();
            return res.redirect('/signup');
        }

        // Check if OTP is already expired
        if (new Date() > user.otp.otpExpiresAt) {
            // Clear the expired OTP
            user.otp = null;
            await user.save();
            req.session.destroy();
            return res.redirect('/signup');
        }

        res.render('user/otp', { 
            otpExpiresAt: user.otp.otpExpiresAt.toISOString(),
            email: req.session.email
        });
    } catch (error) {
        console.error('OTP Page Error:', error);
        res.status(500).render('error', {
            message: 'Error loading OTP page'
        });
    }
};

const getHomePage = async (req, res) => {
    try {
        // Check if user is logged in via session
        if (!req.session.userId) {
            return res.redirect('/');
        }

        // Find user by ID
        const user = await userModel.findById(req.session.userId);
        
        if (!user) {
            // Clear invalid session
            req.session.destroy();
            return res.redirect('/');
        }

        if (user.status !== 'Active') {
            // Clear session for non-active users
            req.session.destroy();
            return res.redirect('/');
        }

        // Get user's wishlist
        const wishlist = await Wishlist.findOne({ userId: user._id });
        const wishlistMap = new Map();
        
        if (wishlist) {
            wishlist.products.forEach(item => {
                const key = `${item.productId.toString()}-${item.variantType}`;
                wishlistMap.set(key, true);
            });
        }

        // Fetch home settings
        let homeSettings = await HomeSettings.findOne();
        if (!homeSettings) {
            // Create default home settings if none exist
            homeSettings = new HomeSettings({
                heroImage: '/images/2026-Bugatti-Tourbillon-007-1440w.jpg',
                leftCategoryImage: '/images/Bugatti.jpg',
                rightCategoryImage: '/images/Koenigsegg Gemera.jpg',
                topCategoryImage: '/images/Aston Martin.jpg',
                bottomCategoryImage: '/images/Rolls Royce.jpg'
            });
            await homeSettings.save();
        }

        // Fetch active categories
        const categories = await Category.find({ status: 'Active' });
        
        // Get current date for offer validation
        const currentDate = new Date();

        // Fetch active offers
        const activeOffers = await Offer.find({
            isActive: true,
            startDate: { $lte: currentDate },
            endDate: { $gte: currentDate }
        });

        // Fetch new arrivals
        const newArrivals = await Product.find({ status: 'Active' })
            .populate('category')
            .sort({ createdAt: -1 })
            .limit(10);

        // Fetch 5 most sold products
        const featuredProducts = await Product.find({ status: 'Active' })
            .populate('category')
            .sort({ soldcount: -1 })
            .limit(5);

        // Process products to include offer information and wishlist status
        const processProduct = (product) => {
            // Convert to plain object if it's a Mongoose document
            const productObj = product.toObject ? product.toObject() : product;
            
            // Add wishlist status to each variant
            if (productObj.variants) {
                productObj.variants = productObj.variants.map(variant => {
                    const inWishlist = wishlistMap.has(`${productObj._id.toString()}-${variant.type}`);
                    return {
                        ...variant,
                        inWishlist
                    };
                });
            }
            
            // Get the base price from the first variant
            const basePrice = productObj.variants && productObj.variants.length > 0 ? 
                productObj.variants[0].price : 0;
            
            // Find product-specific offer
            const productOffer = activeOffers.find(offer => 
                offer.type === 'product' && 
                offer.productIds && offer.productIds.some(id => id.toString() === productObj._id.toString())
            );

            // Find category offer
            const categoryOffer = activeOffers.find(offer => 
                offer.type === 'category' && 
                productObj.category && (
                    (offer.categoryId && offer.categoryId.toString() === productObj.category._id.toString()) ||
                    (offer.categoryIds && offer.categoryIds.some(id => id.toString() === productObj.category._id.toString()))
                )
            );

            // Use product-specific offer if available, otherwise use category offer
            const offer = productOffer || categoryOffer;

            if (offer) {
                const discountedPrice = basePrice - (basePrice * offer.discount / 100);
                productObj.offer = {
                    discount: offer.discount,
                    type: offer.type
                };
                productObj.originalPrice = basePrice;
                productObj.discountedPrice = Math.round(discountedPrice);
            } else {
                productObj.originalPrice = basePrice;
                productObj.discountedPrice = basePrice;
            }
            
            return productObj;
        };

        // Process new arrivals and featured products
        const processedNewArrivals = newArrivals.map(processProduct);
        const processedFeaturedProducts = featuredProducts.map(processProduct);

        // Process handpicked products
        let processedHandpickedProducts = [];
        const handpickedProducts = [
            homeSettings.handpickedProduct1,
            homeSettings.handpickedProduct2,
            homeSettings.handpickedProduct3
        ].filter(product => product && product._id);

        if (handpickedProducts.length > 0) {
            const handpickedProductsFull = await Product.find({ 
                _id: { $in: handpickedProducts.map(p => p._id) },
                status: 'Active'
            })
            .populate('category')
            .select('_id name brand variants images category')
            .lean();
            
            processedHandpickedProducts = handpickedProductsFull.map(processProduct);
        }

        // Get cart count for navbar
        const cartCount = await CartItem.countDocuments({ userId: req.session.userId });

        res.render('user/home', {
            user: {
                firstname: user.firstname,
                lastname: user.lastname,
                email: user.email
            },
            homeSettings,
            categories,
            newArrivals: processedNewArrivals,
            featuredProducts: processedFeaturedProducts,
            handpickedProducts: processedHandpickedProducts,
            cartCount
        });
        
    } catch (error) {
        console.error('Home Page Error:', error);
        // Clear session on error
        req.session.destroy();
        res.redirect('/');
    }
};

const getLogout = (req, res) => {
    // Only clear user-related session data
    delete req.session.userId;
    delete req.session.email;
    delete req.session.isLoggedIn;
    delete req.session.user;

    // Check if the request is coming from admin panel
    const referer = req.headers.referer || '';
    if (referer.includes('/admin')) {
        res.redirect('/admin/dashboard');
    } else {
        res.redirect('/');
    }
};

const postLogin = async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email address'
            });
        }

        // Validate password presence
        if (!password) {
            return res.status(400).json({
                success: false,
                message: 'Password is required'
            });
        }

        // Find user by email
        const user = await userModel.findOne({ email });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Email not registered. Please sign up first.'
            });
        }

        // Check user status
        if (user.status === 'Blocked') {
            return res.status(403).json({
                success: false,
                message: 'Your account has been blocked. Please contact support.'
            });
        }

        if (user.status === 'Pending') {
            req.session.email = email;
            return res.status(403).json({
                success: false,
                message: 'Please verify your email first',
                redirect: '/otpPage'
            });
        }

        // Verify password using bcrypt
        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Invalid password'
            });
        }

        // Set session
        req.session.userId = user._id;
        req.session.email = user.email;
        req.session.isLoggedIn = true;
        req.session.user = {
            firstname: user.firstname,
            lastname: user.lastname,
            email: user.email
        };

        res.json({
            success: true,
            message: 'Login successful',
            redirect: '/home'
        });

    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({
            success: false,
            message: 'An error occurred during login'
        });
    }
};

const getGoogle = (req, res) => {
    console.log('Starting Google authentication');
    passport.authenticate("google", {
        scope: ["email", "profile"],
        prompt: "select_account"
    })(req, res);
};

const getGoogleCallback = (req, res) => {
    console.log('Google callback received');
    passport.authenticate("google", { failureRedirect: "/" }, async (err, profile) => {
        try {
            console.log('Google authentication result:', { err, profile });
            if (err || !profile) {
                console.log("Authentication failed:", err);
                return res.redirect("/?message=Authentication failed&alertType=error");
            }

            // Log the profile data to debug
            console.log("Google Profile:", profile);

            // Correctly extract email from profile
            const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;

            if (!email) {
                console.log("No email found in profile");
                return res.redirect("/?message=Email not provided&alertType=error");
            }

            const existingUser = await userModel.findOne({ email });

            // Split the display name into first and last name
            const names = profile.displayName.split(' ');
            const firstname = names[0];
            const lastname = names.slice(1).join(' ') || '   '; // Provide fallback

            // If user exists, update and login
            if (existingUser) {
                if (existingUser.status === 'Blocked') {
                    return res.redirect("/?message=Your account has been blocked&alertType=error");
                }

                // Update user with Google ID and ensure status is Active
                await userModel.findByIdAndUpdate(existingUser._id, {
                    $set: { 
                        googleId: profile.id,
                        status: 'Active'
                    }
                });
                
                req.session.userId = existingUser._id;
                req.session.email = existingUser.email;
                req.session.isLoggedIn = true;
                
                return res.redirect("/home");
            }

            // Check if user exists with Google ID
            const existingGoogleUser = await userModel.findOne({ googleId: profile.id });
            if (existingGoogleUser) {
                if (existingGoogleUser.status === 'Blocked') {
                    return res.redirect("/?message=Your account has been blocked&alertType=error");
                }

                req.session.userId = existingGoogleUser._id;
                req.session.email = existingGoogleUser.email;
                req.session.isLoggedIn = true;
                
                return res.redirect("/home");
            }

            // Create new user with required fields
            const newUser = new userModel({
                firstname,
                lastname,
                email,
                googleId: profile.id,
                status: 'Active'
            });

            await newUser.save();

            req.session.userId = newUser._id;
            req.session.email = newUser.email;
            req.session.isLoggedIn = true;

            return res.redirect("/home");

        } catch (error) {
            console.error('Google Authentication Error:', error);
            return res.redirect("/?message=Authentication failed&alertType=error");
        }
    })(req, res);
};

const getForgotPassword = (req, res) => {
    res.render('user/forgotPass.ejs');
};

const postForgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        // Find user by email
        const user = await userModel.findOne({ email });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'No account found with this email'
            });
        }

        if (user.status === 'Blocked') {
            return res.status(403).json({
                success: false,
                message: 'Your account has been blocked'
            });
        }

        // Generate OTP
        const otpValue = Math.floor(100000 + Math.random() * 900000).toString();

        // Update user with new OTP
        user.otp = {
            otpValue,
            otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes expiry
            otpAttempts: 0
        };

        await user.save();

        // Send OTP email
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
            tls: {
                rejectUnauthorized: false,
            },
        });

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Password Reset OTP',
            text: `Your OTP for password reset is ${otpValue}. This OTP will expire in 10 minutes.`,
            html: `
                <h2>Password Reset</h2>
                <p>Your OTP for password reset is: <strong>${otpValue}</strong></p>
                <p>This OTP will expire in 10 minutes.</p>
                <p>If you didn't request this, please ignore this email.</p>
            `
        };

        await transporter.sendMail(mailOptions);

        // Store email in session 
        req.session.resetEmail = email;

        res.json({
            success: true,
            message: 'OTP sent to your email'
        });

    } catch (error) {
        console.error('Forgot Password Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing your request'
        });
    }
};

const getResetPassword = (req, res) => {
    if (!req.session.resetEmail) {
        return res.redirect('/forgot-password');
    }
    res.render('user/resetPassword.ejs');
};

const postResetPassword = async (req, res) => {
    try {
        const { otp, newPassword } = req.body;
        const email = req.session.resetEmail;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Reset password session expired'
            });
        }

        const user = await userModel.findOne({ email });

        if (!user || !user.otp) {
            return res.status(400).json({
                success: false,
                message: 'Invalid reset request'
            });
        }

        // Verify OTP
        if (user.otp.otpValue !== otp) {
            user.otp.otpAttempts += 1;
            await user.save();

            if (user.otp.otpAttempts >= 3) {
                user.otp = null;
                await user.save();
                delete req.session.resetEmail;
                
                return res.status(400).json({
                    success: false,
                    message: 'Too many attempts. Please try again.'
                });
            }

            return res.status(400).json({
                success: false,
                message: 'Invalid OTP'
            });
        }

        // Check OTP expiration
        if (new Date() > user.otp.otpExpiresAt) {
            user.otp = null;
            await user.save();
            delete req.session.resetEmail;

            return res.status(400).json({
                success: false,
                message: 'OTP has expired. Please try again.'
            });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update password and clear OTP
        user.password = hashedPassword;
        user.otp = null;
        await user.save();

        // Clear session
        delete req.session.resetEmail;

        res.json({
            success: true,
            message: 'Password reset successful'
        });

    } catch (error) {
        console.error('Reset Password Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error resetting password'
        });
    }
};

const getChangePassword = async (req, res) => {
    try {
        const user = await userModel.findById(req.session.userId);
        res.render('user/changePasswoed', {
            title: 'Change Password',
            user,
            currentPage: 'changepassword'
        });
    } catch (error) {
        console.error('Get Change Password Error:', error);
        res.status(500).render('error', {
            message: 'Error loading change password page'
        });
    }
};

const postChangePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;
        const userId = req.session.userId;

        // Validate inputs
        if (!currentPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'All fields are required'
            });
        }

        // Check password length
        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'New password must be at least 6 characters long'
            });
        }

        // Check if passwords match
        if (newPassword !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'New passwords do not match'
            });
        }

        // Get user
        const user = await userModel.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Check if user has a password (might be a Google auth user)
        if (!user.password) {
            return res.status(400).json({
                success: false,
                message: 'Cannot change password for social login accounts'
            });
        }

        // Verify current password
        const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }

        // Check if new password is same as old password
        const isSamePassword = await bcrypt.compare(newPassword, user.password);
        if (isSamePassword) {
            return res.status(400).json({
                success: false,
                message: 'New password must be different from current password'
            });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update password
        user.password = hashedPassword;
        await user.save();

        res.json({
            success: true,
            message: 'Password updated successfully'
        });

    } catch (error) {
        console.error('Change Password Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating password'
        });
    }
};

// Add this new function to get product images for carousels
export const getProductImages = async (req, res) => {
    try {
        const { productIds } = req.body;
        
        if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Product IDs are required'
            });
        }
        
        // Fetch products with their images
        const products = await Product.find({
            _id: { $in: productIds },
            status: 'Active'
        }).select('_id images');
        
        // Format the response
        const formattedProducts = products.map(product => ({
            _id: product._id,
            images: product.images || []
        }));
        
        res.json({
            success: true,
            products: formattedProducts
        });
    } catch (error) {
        console.error('Error fetching product images:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch product images'
        });
    }
};

// Multer configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/profile')
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname)
    }
});

export const upload = multer({ storage: storage });

export const getProfile = async (req, res) => {
    try {
        // Get userId from session
        const userId = req.session.userId;
        
        if (!userId) {
            return res.redirect('/login');
        }
        
        // Find user by ID instead of email
        const userData = await userModel.findById(userId);
        
        if (!userData) {
            return res.redirect('/login');
        }

        res.render('user/profile', {
            user: userData,
            title: 'User Profile',
            currentPage: 'profile'
        });
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).render('user/error', { message: 'Internal server error', currentPage: 'profile' });
    }
};

export const getEditProfile = async (req, res) => {
    try {
        const userId = req.session.userId;
        
        if (!userId) {
            return res.redirect('/login');
        }
        
        const userData = await userModel.findById(userId);
        
        if (!userData) {
            return res.redirect('/login');
        }

        res.render('user/editProfile', {
            user: userData,
            title: 'Edit Profile',
            currentPage: 'profile'
        });
    } catch (error) {
        console.error('Edit Profile fetch error:', error);
        res.status(500).render('user/error', { message: 'Internal server error', currentPage: 'profile' });
    }
};

export const updateProfile = async (req, res) => {
    try {
        const userId = req.session.userId;
        const { firstname, lastname } = req.body;
        
        // Create update object
        const updateData = { 
            firstname, 
            lastname 
        };
        
        // If a profile image was uploaded, add it to the update data
        if (req.file) {
            // Get the current user to find their old profile image
            const currentUser = await userModel.findById(userId);
            
            // If user has an existing profile image that's not the default, delete it
            if (currentUser.profileImage && currentUser.profileImage !== '/images/default-avatar.png') {
                const oldImagePath = path.join(process.cwd(), 'public', currentUser.profileImage);
                if (fs.existsSync(oldImagePath)) {
                    fs.unlinkSync(oldImagePath);
                }
            }

            // Add new profile image path to update data
            updateData.profileImage = `/uploads/profile/${req.file.filename}`;
        }

        // Find and update user by ID
        const updatedUser = await userModel.findByIdAndUpdate(
            userId,
            updateData,
            { new: true }
        );

        if (!updatedUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Add this new function for wishlist toggle
export const toggleWishlist = async (req, res) => {
    try {
        const userId = req.session.userId;
        const { productId, variantType } = req.body;

        if (!userId || !productId || !variantType) {
            return res.status(400).json({
                success: false,
                message: 'User ID, Product ID, and Variant Type are required'
            });
        }

        // Find user's wishlist
        let wishlist = await Wishlist.findOne({ userId });

        // Check if product with specific variant is already in wishlist
        const isInWishlist = wishlist && wishlist.products.some(
            item => item.productId.toString() === productId && item.variantType === variantType
        );

        if (isInWishlist) {
            // Remove from wishlist
            wishlist.products = wishlist.products.filter(
                item => !(item.productId.toString() === productId && item.variantType === variantType)
            );
            await wishlist.save();
            return res.json({
                success: true,
                message: 'Removed from wishlist',
                inWishlist: false
            });
        }

        // If wishlist doesn't exist, create one
        if (!wishlist) {
            wishlist = new Wishlist({ 
                userId, 
                products: [{
                    productId,
                    variantType,
                    addedAt: new Date()
                }]
            });
            await wishlist.save();
            return res.json({
                success: true,
                message: 'Added to wishlist',
                inWishlist: true
            });
        }

        // Add to wishlist with timestamp
        wishlist.products.push({
            productId,
            variantType,
            addedAt: new Date()
        });
        await wishlist.save();
        
        return res.json({
            success: true,
            message: 'Added to wishlist',
            inWishlist: true
        });

    } catch (error) {
        console.error('Wishlist Toggle Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating wishlist'
        });
    }
};

const resendOTP = async (req, res) => {
    try {
        const email = req.session.email;
        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Session expired. Please sign up again.'
            });
        }

        const user = await userModel.findOne({ email });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found. Please sign up again.'
            });
        }

        // Check if enough time has passed since last OTP (30 seconds)
        const lastOTPTime = user.otp?.resendTimer || new Date(0);
        const timeSinceLastOTP = Date.now() - lastOTPTime.getTime();
        const thirtySeconds = 30 * 1000;

        if (timeSinceLastOTP < thirtySeconds) {
            const remainingTime = Math.ceil((thirtySeconds - timeSinceLastOTP) / 1000);
            return res.status(400).json({
                success: false,
                message: `Please wait ${remainingTime} seconds before requesting a new OTP`,
                secondsLeft: remainingTime
            });
        }

        // Generate new OTP
        const otpValue = Math.floor(100000 + Math.random() * 900000).toString();
        const twoMinutes = 2 * 60 * 1000; // OTP expires in 2 minutes
        const otpExpiryTime = new Date(Date.now() + twoMinutes);
        const resendTimer = new Date(Date.now() + thirtySeconds);

        // Create email transporter
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
            tls: {
                rejectUnauthorized: false,
            },
        });

        // Prepare email options
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Your New OTP Code',
            text: `Your new OTP code is ${otpValue}`,
            html: `
                <h2>New OTP Code</h2>
                <p>Your new OTP code is: <strong>${otpValue}</strong></p>
                <p>This OTP will expire in 2 minutes.</p>
                <p>If you didn't request this, please ignore this email.</p>
            `
        };

        // Send email first
        try {
            await transporter.sendMail(mailOptions);
        } catch (emailError) {
            console.error('Email sending error:', emailError);
            return res.status(500).json({
                success: false,
                message: 'Failed to send OTP email. Please try again.'
            });
        }

        // Only update user data if email was sent successfully
        user.otp = {
            otpValue,
            otpExpiresAt: otpExpiryTime,
            otpAttempts: 0,
            resendTimer: resendTimer
        };

        await user.save();

        // Update session with new expiry time
        req.session.otpExpiresAt = otpExpiryTime;

        res.json({
            success: true,
            message: 'New OTP sent successfully',
            otpExpiresAt: otpExpiryTime.toISOString()
        });

    } catch (error) {
        console.error('Resend OTP Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error sending new OTP. Please try again.'
        });
    }
};

// Add new endpoint to check resend timer status
const checkResendTimer = async (req, res) => {
    try {
        const email = req.session.email;
        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Session expired'
            });
        }

        const user = await userModel.findOne({ email });
        if (!user || !user.otp) {
            return res.status(404).json({
                success: false,
                message: 'User or OTP not found'
            });
        }

        const now = new Date();
        const timeLeft = user.otp.resendTimer ? user.otp.resendTimer - now : 0;
        const secondsLeft = Math.max(0, Math.ceil(timeLeft / 1000));

        res.json({
            success: true,
            secondsLeft,
            canResend: secondsLeft === 0
        });

    } catch (error) {
        console.error('Check Resend Timer Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error checking resend timer'
        });
    }
};

export default { getLogin, getSignup, postSignup, postLogin, getOtpPage, verifyOtp, getHomePage, getLogout, getGoogle, getGoogleCallback, getForgotPassword, postForgotPassword, getResetPassword, postResetPassword, getChangePassword, postChangePassword, getProductImages, toggleWishlist, resendOTP, checkResendTimer };
