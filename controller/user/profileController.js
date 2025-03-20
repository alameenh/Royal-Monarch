import User from '../../model/userModel.js';

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

    updateProfile: async (req, res) => {
        try {
            const userEmail = req.session.user.email;
            const { name, phone, address } = req.body;

            const updatedUser = await User.findOneAndUpdate(
                { email: userEmail },
                { name, phone, address },
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
    }
};

export default profileController;