import User from '../../model/userModel.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Configure multer for image upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'public/uploads/profile';
        // Create directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png|webp/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Only image files (jpeg, jpg, png, webp) are allowed!'));
    }
});

const profileController = {
    getProfile: async (req, res) => {
        try {
            const userEmail = req.session.email;
            const userData = await User.findOne({ email: userEmail });
            
            if (!userData) {
                return res.redirect('/');
            }

            res.render('user/profile', {
                user: userData,
                title: 'User Profile',
                currentPage: 'profile'
            });
        } catch (error) {
            console.error('Profile fetch error:', error);
            res.status(500).render('error', { message: 'Internal server error' });
        }
    },

    getEditProfile: async (req, res) => {
        try {
            const userEmail = req.session.email;
            const userData = await User.findOne({ email: userEmail });
            
            if (!userData) {
                return res.redirect('/');
            }

            res.render('user/editProfile', {
                user: userData,
                title: 'Edit Profile',
                currentPage: 'profile'
            });
        } catch (error) {
            console.error('Edit profile fetch error:', error);
            res.status(500).render('error', { message: 'Internal server error' });
        }
    },

    updateProfile: async (req, res) => {
        try {
            const userEmail = req.session.email;
            const { firstname, lastname, email } = req.body;

            // Input validation
            if (!firstname || !lastname) {
                return res.status(400).json({
                    success: false,
                    message: 'First name and last name are required'
                });
            }
            
            // Find current user
            const currentUser = await User.findOne({ email: userEmail });
            if (!currentUser) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }

            // Prepare update object
            const updateData = {
                firstname,
                lastname
            };

            // Handle email update for non-Google users
            if (!currentUser.googleId && email && email !== userEmail) {
                const emailExists = await User.findOne({ 
                    email: email,
                    _id: { $ne: currentUser._id } 
                });
                
                if (emailExists) {
                    return res.status(400).json({
                        success: false,
                        message: 'Email already exists'
                    });
                }
                updateData.email = email;
            }

            // Handle profile image
            if (req.file) {
                // Delete old profile image if it exists and isn't the default
                if (currentUser.profileImage && 
                    currentUser.profileImage !== '/images/default-avatar.png' && 
                    fs.existsSync('public' + currentUser.profileImage)) {
                    fs.unlinkSync('public' + currentUser.profileImage);
                }
                updateData.profileImage = '/uploads/profile/' + req.file.filename;
            }

            // Update user
            const updatedUser = await User.findOneAndUpdate(
                { email: userEmail },
                updateData,
                { new: true }
            );

            if (!updatedUser) {
                return res.status(404).json({
                    success: false,
                    message: 'Failed to update profile'
                });
            }

            // Update session email if changed
            if (updateData.email) {
                req.session.email = updateData.email;
            }

            res.json({
                success: true,
                message: 'Profile updated successfully',
                user: updatedUser
            });

        } catch (error) {
            console.error('Profile update error:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }
};

export { profileController, upload };