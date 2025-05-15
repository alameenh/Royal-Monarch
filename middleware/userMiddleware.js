import userModel from "../model/userModel.js"
import CartItem from "../model/cartModel.js"
import Wishlist from "../model/wishlistModel.js"

const checkSession = async (req, res, next) => {
    try {
        // Skip session check for admin routes
        if (req.path.startsWith('/admin')) {
            return next();
        }

        if (!req.session.isLoggedIn) {
            // Check if it's an API request
            if (req.path.startsWith('/api/') || req.xhr) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
            }
            return res.redirect('/');
        }
        next();
    } catch (error) {
        console.error('Middleware Error:', error);
        if (req.path.startsWith('/api/') || req.xhr) {
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
        res.status(500).render('error', {
            message: 'Internal server error'
        });
    }
}

const isLogin = (req, res, next) => {
    try {
        if (req.session.isLoggedIn) {
            // Check if it's an API request
            if (req.path.startsWith('/api/') || req.xhr) {
                return res.status(403).json({
                    success: false,
                    message: 'Already logged in'
                });
            }
            return res.redirect('/home');
        }
        next();
    } catch (error) {
        console.error('Middleware Error:', error);
        if (req.path.startsWith('/api/') || req.xhr) {
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
        res.status(500).render('error', {
            message: 'Internal server error'
        });
    }
}

const getCounts = async (req, res, next) => {
    try {
        if (req.session.userId) {
            // Get cart count
            const cartCount = await CartItem.countDocuments({ userId: req.session.userId });
            
            // Get wishlist count
            const wishlist = await Wishlist.findOne({ userId: req.session.userId });
            const wishlistCount = wishlist ? wishlist.products.length : 0;
            
            // Add counts to res.locals for use in templates
            res.locals.cartCount = cartCount;
            res.locals.wishlistCount = wishlistCount;
        } else {
            res.locals.cartCount = 0;
            res.locals.wishlistCount = 0;
        }
        next();
    } catch (error) {
        console.error('Error getting counts:', error);
        res.locals.cartCount = 0;
        res.locals.wishlistCount = 0;
        next();
    }
};

const checkBlockedStatus = async (req, res, next) => {
    try {
        // Skip check for public routes and admin routes
        if (!req.session.userId || req.path.startsWith('/admin')) {
            return next();
        }

        const user = await userModel.findById(req.session.userId);
        if (user && user.status === "Blocked") {
            // Clear the session
        delete req.session.userId;
        delete req.session.email;
        delete req.session.isLoggedIn;
        delete req.session.user;
            
            // Check if it's an API request
            if (req.path.startsWith('/api/') || req.xhr) {
                return res.status(403).json({
                    success: false,
                    message: 'Your account has been blocked. Please contact support.'
                });
            }
            
            return res.redirect('/?error=account_blocked');
        }
        next();
    } catch (error) {
        console.error('Blocked Status Check Error:', error);
        if (req.path.startsWith('/api/') || req.xhr) {
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
        res.status(500).render('error', {
            message: 'Internal server error'
        });
    }
};

export default { 
    isLogin, 
    checkSession,
    getCounts,
    checkBlockedStatus
}