import { config } from 'dotenv';

config()

const getAdmin = (req, res) => {
    res.render('admin/login');
}

const postAdmin = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email address'
            });
        }

        if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
            
            req.session.admin = true;
            console.log('loginned')
            return res.json({
                success: true,
                message: 'Login successful',
                redirectUrl: '/admin/dashboard'
            });
        } else {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }
    } catch (error) {
        console.error('Admin login error:', error);
        return res.status(500).json({
            success: false,
            message: 'An error occurred during login'
        });
    }
}

const getLogout = (req, res) => {
    req.session.destroy(() => {
        res.redirect('/admin/login');
    });
}

const getDashboard = (req, res) => {
    console.log("request to the dashboard")
    res.render('admin/dashboard');
}



export default { getAdmin, postAdmin, getLogout,getDashboard }