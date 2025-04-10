import nodemailer from 'nodemailer';
import userModel from '../../model/userModel.js';
import { config } from 'dotenv';
import bcrypt from 'bcrypt';
import Category from '../../model/categoryModel.js';
import Product from '../../model/productModel.js';
import passport from 'passport';
import CartItem from '../../model/cartModel.js';

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
        // Fetch active categories
        const categories = await Category.find({ status: 'Active' });


        const featuredProducts = await Product.find({ 
            status: 'Active',
            discount: { $gt: 0 }
        })
        .populate('category')
        .sort({ discount: -1 })
        .limit(8);

   
        const newArrivals = await Product.find({ status: 'Active' })
        .populate('category')
        .sort({ createdAt: -1 })
        .limit(8);

        // Get cart count for navbar
        const cartCount = await CartItem.countDocuments({ userId: req.session.userId });

        res.render('user/home', {
            user,
            categories,
            featuredProducts,
            newArrivals,
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
        const { email, password } = req.body;

  
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
        req.session.userId =user._id;
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
    passport.authenticate("google", {
        scope: ["email", "profile"],
        prompt: "select_account"
    })(req, res);
};

const getGoogleCallback = (req, res) => {
    passport.authenticate("google", { failureRedirect: "/" }, async (err, profile) => {
        try {
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

export default { getLogin, getSignup, postSignup, postLogin, getOtpPage, verifyOtp, getHomePage, getLogout, getGoogle, getGoogleCallback, getForgotPassword, postForgotPassword, getResetPassword, postResetPassword, getChangePassword, postChangePassword };
