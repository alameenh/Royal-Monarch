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
            
            // Trim all input values
            const name = req.body.name.trim();
            const houseName = req.body.houseName.trim();
            const localityStreet = req.body.localityStreet.trim();
            const city = req.body.city.trim();
            const state = req.body.state.trim();
            const pincode = req.body.pincode.trim();
            const phone = req.body.phone.trim();
            const alternatePhone = req.body.alternatePhone ? req.body.alternatePhone.trim() : null;
            
            // Check for empty strings after trimming
            if (!name || !houseName || !localityStreet || !city || !state || !pincode || !phone) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'All required fields must not be empty' 
                });
            }
            
            // Name validation
            if (name.length < 3 || !/^[a-zA-Z\s]+$/.test(name)) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Name must be at least 3 characters long and contain only letters and spaces' 
                });
            }
            
            // Address validation
            if (houseName.length < 5) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'House name/number must be at least 5 characters long' 
                });
            }
            
            if (localityStreet.length < 5) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Street/Locality must be at least 5 characters long' 
                });
            }
            
            // City and State validation
            if (city.length < 2 || !/^[a-zA-Z\s]+$/.test(city)) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'City must be at least 2 characters long and contain only letters and spaces' 
                });
            }
            
            if (state.length < 2 || !/^[a-zA-Z\s]+$/.test(state)) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'State must be at least 2 characters long and contain only letters and spaces' 
                });
            }
            
            // Phone number validation
            if (!phone.match(/^\d{10}$/)) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Phone number must be 10 digits' 
                });
            }
            
            // Alternate phone validation (if provided)
            if (alternatePhone && !alternatePhone.match(/^\d{10}$/)) {
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
                name,
                houseName,
                localityStreet,
                city,
                state,
                pincode,
                phone,
                alternatePhone
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
            
            console.log("Fetching address:", addressId, "for user:", userId); 
            
            const address = await Address.findOne({ _id: addressId, userId });
            
            if (!address) {
                console.log("Address not found"); 
                return res.status(404).json({ 
                    success: false, 
                    message: 'Address not found' 
                });
            }
            
            console.log("Found address:", address); 
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
            
            // Trim all input values
            const name = req.body.name.trim();
            const houseName = req.body.houseName.trim();
            const localityStreet = req.body.localityStreet.trim();
            const city = req.body.city.trim();
            const state = req.body.state.trim();
            const pincode = req.body.pincode.trim();
            const phone = req.body.phone.trim();
            const alternatePhone = req.body.alternatePhone ? req.body.alternatePhone.trim() : null;
            
            // Check for empty strings after trimming
            if (!name || !houseName || !localityStreet || !city || !state || !pincode || !phone) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'All required fields must not be empty' 
                });
            }
            
            // Name validation
            if (name.length < 3 || !/^[a-zA-Z\s]+$/.test(name)) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Name must be at least 3 characters long and contain only letters and spaces' 
                });
            }
            
            // Address validation
            if (houseName.length < 5) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'House name/number must be at least 5 characters long' 
                });
            }
            
            if (localityStreet.length < 5) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Street/Locality must be at least 5 characters long' 
                });
            }
            
            // City and State validation
            if (city.length < 2 || !/^[a-zA-Z\s]+$/.test(city)) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'City must be at least 2 characters long and contain only letters and spaces' 
                });
            }
            
            if (state.length < 2 || !/^[a-zA-Z\s]+$/.test(state)) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'State must be at least 2 characters long and contain only letters and spaces' 
                });
            }
            
            // Phone number validation
            if (!phone.match(/^\d{10}$/)) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Phone number must be 10 digits' 
                });
            }
            
            // Alternate phone validation (if provided)
            if (alternatePhone && !alternatePhone.match(/^\d{10}$/)) {
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
            
            address.name = name;
            address.houseName = houseName;
            address.localityStreet = localityStreet;
            address.city = city;
            address.state = state;
            address.pincode = pincode;
            address.phone = phone;
            address.alternatePhone = alternatePhone;
            
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