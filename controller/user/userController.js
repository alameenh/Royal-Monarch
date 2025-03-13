import nodemailer from 'nodemailer';
import userModel from '../../model/userModel.js';
import { config } from 'dotenv';
import bcrypt from 'bcrypt';
import Category from '../../model/categoryModel.js';
import Product from '../../model/productModel.js';

config();

const getLogin = (req, res) => {
    res.render('user/login.ejs');
}

const getSignup = (req, res) => {
    res.render('user/signup.ejs');
}

const postSignup = async (req, res) => {
    try {
        const { firstName, lastName, email, password } = req.body;

        // Validate input
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

        // Create new user with hashed password
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
        user.status = 'Active'; // Update status to 'Active'
        user.otp = null; // Clear OTP after successful verification
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
    // Pass otpExpiresAt to the EJS template
    res.render('user/otp.ejs', { otpExpiresAt: user.otp.otpExpiresAt.toISOString() });
};

const getHomePage = async (req, res) => {
    try {
        if (!req.session.email) {
            return res.redirect('/login');
        }

        const user = await userModel.findOne({ email: req.session.email });
        
        if (!user || user.status !== 'Active') {
            return res.redirect('/login');
        }

        // Fetch active categories
        const categories = await Category.find({ status: 'Active' });

        // Fetch featured products (active products with discount)
        const featuredProducts = await Product.find({ 
            status: 'Active',
            discount: { $gt: 0 }
        })
        .populate('category')
        .sort({ discount: -1 })
        .limit(8);

        // Fetch new arrivals
        const newArrivals = await Product.find({ status: 'Active' })
        .populate('category')
        .sort({ createdAt: -1 })
        .limit(8);

        res.render('user/home', {
            user,
            categories,
            featuredProducts,
            newArrivals
        });
        
    } catch (error) {
        console.error('Home Page Error:', error);
        res.redirect('/login');
    }
};

const getLogout = (req, res) => {
    req.session.destroy();
    res.redirect('/login');
};

const postLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate input
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }

        // Find user by email
        const user = await userModel.findOne({ email });

        // Check if user exists
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
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
            // Store email in session for OTP verification
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
                message: 'Invalid email or password'
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

export default { getLogin, getSignup, postSignup, postLogin, getOtpPage, verifyOtp, getHomePage, getLogout };
