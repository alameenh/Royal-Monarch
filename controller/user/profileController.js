import User from '../../model/userModel.js';
import multer from 'multer';

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
        const userData = await User.findById(userId);
        
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
        
        const userData = await User.findById(userId);
        
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
            updateData.profileImage = `/uploads/profile/${req.file.filename}`;
        }

        // Find and update user by ID
        const updatedUser = await User.findByIdAndUpdate(
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