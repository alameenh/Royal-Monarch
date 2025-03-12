// import userModel from '../../model/userModel.js';
import nodemailer from 'nodemailer';
import userModel from '../../model/userModel.js';
import { config } from 'dotenv';

config();

const getLogin = (req,res)=>{
    res.render('user/login.ejs');
}

const getSignup = (req,res)=>{
    res.render('user/signup.ejs');
}

const postSignup = async (req, res) => {
    const { firstName, lastName, email, password } = req.body;
    console.log("Body:", firstName, lastName, email, password);
    // Validate input
    if (!firstName || !lastName || !email || !password) {
        return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    // Check if user already exists
    let existingUser = await userModel.findOne({ email });
    console.log(existingUser);
    if(existingUser && existingUser.status =='Pending'){
        await userModel.deleteOne({ email });
        existingUser = null;
    }
    //klkjhgfvd

    if (existingUser ) {
        return res.status(400).json({ success: false, message: 'Email already registered' });
    }


    // Generate OTP
    const otpValue = Math.floor(100000 + Math.random() * 900000).toString();

    // Create new user with status 'Pending'
    const newUser = new userModel({
        firstname: firstName,
        lastname: lastName,
        email,
        password, // Note: Password should be hashed in a real application
        status: 'Pending',
        otp: {
            otpValue,
            otpExpiresAt: new Date(Date.now() + 2 * 60 * 1000), // OTP valid for 2 minutes
        },
    });
    console.log("New user created")

    await newUser.save();
    console.log("user saved")

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

const getHomePage = (req, res) => {
    if (req.session.email) {
        userModel.findOne({ email: req.session.email }, (err, user) => {
            if (err || !user || user.status !== 'Active') {
                return res.redirect('/signup');
            }else if(user.status === 'Active'){
                res.render('user/home.ejs'); // Render the home page
            }
        });
    } else {
        res.redirect('/signup');
    }
};

export default {getLogin,getSignup,postSignup,getOtpPage,verifyOtp,getHomePage};
