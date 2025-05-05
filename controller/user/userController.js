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
    if (req.session.isAuth) {
        return res.redirect('/home');
    }
    res.render('user/signup.ejs');
}

const postSignup = async (req, res) => {
    try {
        const { firstName, lastName, email, password } = req.body;

        console.log("email in post signup",req.body.email);
        if (!firstName || !lastName || !email || !password) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        // Check if user already exists
        let existingUser = await userModel.findOne({ email });
        if (existingUser && existingUser.status == 'Pending') {
            await userModel.deleteOne({ email });
            existingUser = null;
        }

        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Email already registered' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Generate OTP
        const otpValue = Math.floor(100000 + Math.random() * 900000).toString();

        // Create new user
        const newUser = new userModel({
            firstname: firstName,
            lastname: lastName,
            email,
            password: hashedPassword,
            status: 'Pending',
            otp: {
                otpValue,
                otpExpiresAt: new Date(Date.now() + 2 * 60 * 1000),
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
            to: email,
            subject: 'Your OTP Code',
            text: `Your OTP code is ${otpValue}`,
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error('Error sending email:', error);
                return res.status(500).json({ success: false, message: 'Error sending OTP email' });
            }
            req.session.email = email; // Store email in session for OTP verification
            res.json({ success: true, message: 'Signup successful, OTP sent to email' });
        });
        console.log("Email sent")
    } catch (error) {
        console.error('Signup Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error during signup process'
        });
    }
};

const verifyOtp = async (req, res) => {
    const { otp } = req.body;
    const user = await userModel.findOne({ email: req.session.email });

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
    const user = await userModel.findOne({ email: req.session.email });
    if (!user) {
        return res.redirect('/signup');
    }
        res.render('user/otp.ejs', { otpExpiresAt: user.otp.otpExpiresAt.toISOString() });
};

const getHomePage = async (req, res) => {
    try {
        if (!req.session.email) {
            return res.redirect('/');
        }

        const user = await userModel.findOne({ email: req.session.email });
        
        if (!user || user.status !== 'Active') {
            return res.redirect('/');
        }

        // Get user's wishlist
        const wishlist = await Wishlist.findOne({ userId: user._id });
        const wishlistProductIds = wishlist ? wishlist.products.map(id => id.toString()) : [];

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

        // Process products to include offer information
        const processedNewArrivals = newArrivals.map(product => {
            const productObj = product.toObject();
            productObj.inWishlist = wishlistProductIds.includes(product._id.toString());
            // Get the base price from the first variant
            const basePrice = product.variants && product.variants.length > 0 ? 
                product.variants[0].price : 0;
            
            // Find product-specific offer
            const productOffer = activeOffers.find(offer => 
                offer.type === 'product' && 
                offer.productIds && offer.productIds.some(id => id.toString() === product._id.toString())
            );

            // Find category offer - check both categoryId and categoryIds fields
            const categoryOffer = activeOffers.find(offer => 
                offer.type === 'category' && 
                product.category && (
                    (offer.categoryId && offer.categoryId.toString() === product.category._id.toString()) ||
                    (offer.categoryIds && offer.categoryIds.some(id => id.toString() === product.category._id.toString()))
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
        });

        // Process featured products similarly
        const processedFeaturedProducts = featuredProducts.map(product => {
            const productObj = product.toObject();
            productObj.inWishlist = wishlistProductIds.includes(product._id.toString());
            // Get the base price from the first variant
            const basePrice = product.variants && product.variants.length > 0 ? 
                product.variants[0].price : 0;
            
            // Find product-specific offer
            const productOffer = activeOffers.find(offer => 
                offer.type === 'product' && 
                offer.productIds && offer.productIds.some(id => id.toString() === product._id.toString())
            );

            // Find category offer - check both categoryId and categoryIds fields
            const categoryOffer = activeOffers.find(offer => 
                offer.type === 'category' && 
                product.category && (
                    (offer.categoryId && offer.categoryId.toString() === product.category._id.toString()) ||
                    (offer.categoryIds && offer.categoryIds.some(id => id.toString() === product.category._id.toString()))
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
        });

        // Process handpicked products with offer information
        let processedHandpickedProducts = [];
        const handpickedProducts = [
            homeSettings.handpickedProduct1,
            homeSettings.handpickedProduct2,
            homeSettings.handpickedProduct3
        ].filter(product => product && product._id);

        if (handpickedProducts.length > 0) {
            // Get product IDs from handpicked products
            const handpickedProductIds = handpickedProducts.map(product => product._id);
            
            // Fetch full product details for handpicked products
            const handpickedProductsFull = await Product.find({ 
                _id: { $in: handpickedProductIds },
                status: 'Active'
            })
            .populate('category')
            .select('_id name brand variants images category')
            .lean();
            
            // Create a map for quick lookup
            const handpickedProductsMap = new Map();
            handpickedProductsFull.forEach(product => {
                handpickedProductsMap.set(product._id.toString(), product);
            });
            
            // Process each handpicked product
            processedHandpickedProducts = handpickedProducts.map(handpickedProduct => {
                const productId = handpickedProduct._id.toString();
                const fullProduct = handpickedProductsMap.get(productId);
                
                if (!fullProduct) {
                    return null;
                }
                
                const productObj = {
                    _id: handpickedProduct._id,
                    name: handpickedProduct.name,
                    imagePath: handpickedProduct.imagePath || (fullProduct.images && fullProduct.images.length > 0 ? fullProduct.images[0].path : ''),
                    brand: fullProduct.brand || 'N/A',
                    inWishlist: wishlistProductIds.includes(productId)
                };
                
                // Get the base price from the first variant
                const basePrice = fullProduct.variants && fullProduct.variants.length > 0 ? 
                    fullProduct.variants[0].price : 0;
                
                // Find product-specific offer
                const productOffer = activeOffers.find(offer => 
                    offer.type === 'product' && 
                    offer.productIds && offer.productIds.some(id => id.toString() === productId)
                );

                // Find category offer
                const categoryOffer = activeOffers.find(offer => 
                    offer.type === 'category' && 
                    fullProduct.category && (
                        (offer.categoryId && offer.categoryId.toString() === fullProduct.category._id.toString()) ||
                        (offer.categoryIds && offer.categoryIds.some(id => id.toString() === fullProduct.category._id.toString()))
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
            }).filter(Boolean); // Remove any null values
        }

        // Get cart count for navbar
        const cartCount = await CartItem.countDocuments({ userId: req.session.userId });

        res.render('user/home', {
            user: req.session.user,
            homeSettings,
            categories,
            newArrivals: processedNewArrivals,
            featuredProducts: processedFeaturedProducts,
            handpickedProducts: processedHandpickedProducts,
            cartCount
        });
        
    } catch (error) {
        console.error('Home Page Error:', error);
        res.redirect('/');
    }
};

const getLogout = (req, res) => {
    req.session.destroy();
    res.redirect('/');
};

const postLogin = async (req, res) => {
    try {
        // Validate request body structure
        if (!req.body || typeof req.body !== 'object') {
            console.log('Invalid request body structure:', {
                bodyExists: !!req.body,
                bodyType: typeof req.body,
                rawBody: req.body
            });
            return res.status(400).json({
                success: false,
                message: 'Invalid request format'
            });
        }

        const { email, password } = req.body;
        
        console.log('Extracted credentials:', {
            email: email ? '***@***' : 'undefined',
            password: password ? '***' : 'undefined'
        });

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            console.log('Invalid email format:', email);
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email address'
            });
        }

        // Validate password presence
        if (!password) {
            console.log('Password is required');
            return res.status(400).json({
                success: false,
                message: 'Password is required'
            });
        }

        // Find user by email
        console.log('Searching for user with email:', email);
        const user = await userModel.findOne({ email });
        console.log('User found:', user ? 'Yes' : 'No');

        if (!user) {
            console.log('User not found for email:', email);
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        // Check user status
        if (user.status === 'Blocked') {
            console.log('User is blocked:', email);
            return res.status(403).json({
                success: false,
                message: 'Your account has been blocked. Please contact support.'
            });
        }

        if (user.status === 'Pending') {
            console.log('User is pending verification:', email);
            req.session.email = email;
            return res.status(403).json({
                success: false,
                message: 'Please verify your email first',
                redirect: '/otpPage'
            });
        }

        // Verify password using bcrypt
        console.log('Verifying password...');
        const isPasswordValid = await bcrypt.compare(password, user.password);
        console.log('Password verification result:', isPasswordValid);

        if (!isPasswordValid) {
            console.log('Invalid password for user:', email);
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        // Set session
        console.log('Setting session for user:', email);
        req.session.userId = user._id;
        req.session.email = user.email;
        req.session.isLoggedIn = true;
        req.session.user = {
            firstname: user.firstname,
            lastname: user.lastname,
            email: user.email
        };

        console.log('Login successful for user:', email);
        res.json({
            success: true,
            message: 'Login successful',
            redirect: '/home'
        });

    } catch (error) {
        console.error('Login Error:', error);
        console.error('Error stack:', error.stack);
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
            const lastname = names.slice(1).join(' ') || 'Unknown'; // Provide fallback

            // If user exists, update and login
            if (existingUser) {
                if (existingUser.status === 'Blocked') {
                    return res.redirect("/?message=Your account has been blocked&alertType=error");
                }

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

            // Create new user with required fields
            const newUser = new userModel({
                firstname,
                lastname,
                email,  
                googleId: profile.id,
                status: 'Active',
                password: 'google-auth-' + Date.now() 
            });

            console.log("Creating new user:", {
                firstname,
                lastname,
                email,
                googleId: profile.id
            });

            await newUser.save();
            
            req.session.userId = newUser._id;
            req.session.email = newUser.email;
            req.session.isLoggedIn = true;

            return res.redirect("/home");

        } catch (error) {
            console.error("Google authentication error:", error);
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
        const productId = req.params.productId;

        // Find user's wishlist
        let wishlist = await Wishlist.findOne({ userId });

        // If wishlist doesn't exist, create one
        if (!wishlist) {
            wishlist = new Wishlist({ userId, products: [] });
        }

        // Check if product is already in wishlist
        const productIndex = wishlist.products.indexOf(productId);

        if (productIndex === -1) {
            // Add to wishlist
            wishlist.products.push(productId);
        } else {
            // Remove from wishlist
            wishlist.products.splice(productIndex, 1);
        }

        await wishlist.save();

        res.json({
            success: true,
            message: productIndex === -1 ? 'Added to wishlist' : 'Removed from wishlist'
        });

    } catch (error) {
        console.error('Wishlist Toggle Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating wishlist'
        });
    }
};

export default { getLogin, getSignup, postSignup, postLogin, getOtpPage, verifyOtp, getHomePage, getLogout, getGoogle, getGoogleCallback, getForgotPassword, postForgotPassword, getResetPassword, postResetPassword, getChangePassword, postChangePassword, getProductImages, toggleWishlist };
