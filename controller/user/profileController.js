import User from '../../model/userModel.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Validation functions
const validateName = (name, isLastName = false) => {
    if (!name || typeof name !== 'string') {
        return {
            isValid: false,
            message: 'Name is required and must be a string'
        };
    }

    const trimmedName = name.trim();
    
    if (!trimmedName) {
        return {
            isValid: false,
            message: 'Name cannot be empty or contain only whitespace'
        };
    }

    const minLength = isLastName ? 1 : 2;
    if (trimmedName.length < minLength || trimmedName.length > 50) {
        return {
            isValid: false,
            message: `Name must be between ${minLength} and 50 characters`
        };
    }

    const nameRegex = /^[A-Za-z\s]+$/;
    if (!nameRegex.test(trimmedName)) {
        return {
            isValid: false,
            message: 'Name should only contain letters and spaces'
        };
    }

    // Check for consecutive spaces
    if (trimmedName.includes('  ')) {
        return {
            isValid: false,
            message: 'Name cannot contain consecutive spaces'
        };
    }

    // Check for leading/trailing spaces
    if (trimmedName !== name) {
        return {
            isValid: false,
            message: 'Name cannot start or end with spaces'
        };
    }

    return {
        isValid: true,
        value: trimmedName
    };
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

// File filter for multer
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only JPEG, PNG and GIF are allowed.'), false);
    }
};

export const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

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

        // Check if user has a valid password
        const hasPassword = userData.password && userData.password.trim() !== '' && userData.password !== null && userData.password !== undefined;

        res.render('user/profile', {
            user: userData,
            hasPassword: hasPassword,
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
        
        // Validate firstname
        const firstnameValidation = validateName(firstname, false);
        if (!firstnameValidation.isValid) {
            return res.status(400).json({ 
                success: false, 
                message: `First name: ${firstnameValidation.message}` 
            });
        }
        
        // Validate lastname
        const lastnameValidation = validateName(lastname, true);
        if (!lastnameValidation.isValid) {
            return res.status(400).json({ 
                success: false, 
                message: `Last name: ${lastnameValidation.message}` 
            });
        }
        
        // Create update object with validated and trimmed values
        const updateData = { 
            firstname: firstnameValidation.value, 
            lastname: lastnameValidation.value 
        };
        
        // If a profile image was uploaded, add it to the update data
        if (req.file) {
            // Get the current user to find their old profile image
            const currentUser = await User.findById(userId);
            
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
        // Handle multer errors specifically
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ 
                success: false, 
                message: 'File size too large. Maximum size is 5MB' 
            });
        }
        if (error.message.includes('Invalid file type')) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid file type. Only JPEG, PNG and GIF are allowed' 
            });
        }
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
}; 