import Address from '../../model/addressModel.js';
import User from '../../model/userModel.js';
const addressController = {
    // Get address page
    getAddressPage: async (req, res) => {
        try {
            console.log(req.session);
            const userId = req.session.userId;
            const user = await User.findById(userId);
            const addresses = await Address.find({ userId }).sort({ createdAt: -1 });
            
            res.render('user/address', {
                title: 'Address Management',
                user,
                addresses,
                currentPage: 'address'
            });
        } catch (error) {
            console.error('Error fetching addresses:', error);
            res.status(500).render('error', { 
                message: 'Error loading addresses. Please try again later.',
                error: { status: 500 }
            });
        }
    },

    // Add new address
    addAddress: async (req, res) => {
        try {
            const userId = req.session.userId;
            const { phone, alternatePhone, pincode } = req.body;
            
            // Phone number validation
            if (!phone.match(/^\d{10}$/)) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Phone number must be 10 digits' 
                });
            }
            
            // Alternate phone validation (if provided)
            if (alternatePhone && alternatePhone.trim() !== '' && !alternatePhone.match(/^\d{10}$/)) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Alternate phone number must be 10 digits' 
                });
            }
            
            // Pincode validation
            if (!pincode.match(/^\d{6}$/)) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Pincode must be 6 digits' 
                });
            }
            
            // Check if user already has 4 addresses
            const addressCount = await Address.countDocuments({ userId });
            if (addressCount >= 4) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'You can only save up to 4 addresses' 
                });
            }
            
            const newAddress = new Address({
                userId,
                name: req.body.name,
                houseName: req.body.houseName,
                localityStreet: req.body.localityStreet,
                city: req.body.city,
                state: req.body.state,
                pincode: req.body.pincode,
                phone: req.body.phone,
                alternatePhone: req.body.alternatePhone || null
            });
            
            await newAddress.save();
            
            res.redirect('/address');
        } catch (error) {
            console.error('Error adding address:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Failed to add address. Please try again.' 
            });
        }
    },

    // Get a specific address by ID - Fix for modal fetching
    getAddressById: async (req, res) => {
        try {
            const userId = req.session.userId;
            const addressId = req.params.id;
            
            console.log("Fetching address:", addressId, "for user:", userId); // Debug log
            
            const address = await Address.findOne({ _id: addressId, userId });
            
            if (!address) {
                console.log("Address not found"); // Debug log
                return res.status(404).json({ 
                    success: false, 
                    message: 'Address not found' 
                });
            }
            
            console.log("Found address:", address); // Debug log
            res.json(address);
        } catch (error) {
            console.error('Error fetching address by ID:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Failed to fetch address. Please try again.' 
            });
        }
    },

    // Update an existing address
    updateAddress: async (req, res) => {
        try {
            const userId = req.session.userId;
            const addressId = req.body.addressId;
            const { phone, alternatePhone, pincode } = req.body;
            
            // Phone number validation
            if (!phone.match(/^\d{10}$/)) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Phone number must be 10 digits' 
                });
            }
            
            // Alternate phone validation (if provided)
            if (alternatePhone && alternatePhone.trim() !== '' && !alternatePhone.match(/^\d{10}$/)) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Alternate phone number must be 10 digits' 
                });
            }
            
            // Pincode validation
            if (!pincode.match(/^\d{6}$/)) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Pincode must be 6 digits' 
                });
            }
            
            const address = await Address.findOne({ _id: addressId, userId });
            
            if (!address) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'Address not found' 
                });
            }
            
            address.name = req.body.name;
            address.houseName = req.body.houseName;
            address.localityStreet = req.body.localityStreet;
            address.city = req.body.city;
            address.state = req.body.state;
            address.pincode = req.body.pincode;
            address.phone = req.body.phone;
            address.alternatePhone = req.body.alternatePhone || null;
            
            await address.save();
            
            res.redirect('/address');
        } catch (error) {
            console.error('Error updating address:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Failed to update address. Please try again.' 
            });
        }
    },

    // Delete an address
    deleteAddress: async (req, res) => {
        try {
            const userId = req.session.userId;
            const addressId = req.body.addressId;
            console.log(addressId,userId  );
            
            const result = await Address.deleteOne({ _id: addressId, userId });
            
            if (result.deletedCount === 0) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'Address not found' 
                });
            }
            
            res.redirect('/address');
        } catch (error) {
            console.error('Error deleting address:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Failed to delete address. Please try again.' 
            });
        }
    }
};

export default addressController; 