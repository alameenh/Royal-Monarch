import userModel from "../model/userModel.js"

const checkSession = async (req, res, next) => {
    try {
        // Check if session exists
        if (!req.session.email) {
            req.session.alert = {
                message: 'Please login to continue',
                type: 'info'
            };
            return res.redirect('/login');
        }

        // Verify user exists and is active
        const user = await userModel.findOne({ email: req.session.email });
        
        if (!user) {
            // User no longer exists
            req.session.destroy();
            req.session.alert = {
                message: 'Account not found',
                type: 'error'
            };
            return res.redirect('/login');
        }

        if (user.status === 'Blocked') {
            // User is blocked
            req.session.destroy();
            req.session.alert = {
                message: 'Your account has been blocked',
                type: 'error'
            };
            return res.redirect('/login');
        }

        next();

    } catch (error) {
        console.error('Session Check Error:', error);
        req.session.alert = {
            message: 'Session error occurred',
            type: 'error'
        };
        return res.redirect('/login');
    }
}

const isLogin = async (req, res, next) => {
    try {
        if (req.session.email) {
            return res.redirect('/home');
        }
        next();
    } catch (error) {
        console.error('Login Check Error:', error);
        next();
    }
}

export default { 
    isLogin, 
    checkSession 
}