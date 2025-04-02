import Coupon from '../../model/couponModel.js';

const couponController = {
    getCoupons: async (req, res) => {
        try {
            // Use aggregation to get usage count for each coupon
            const coupons = await Coupon.aggregate([
                {
                    $project: {
                        code: 1,
                        description: 1,
                        discountType: 1,
                        discountValue: 1,
                        minPurchase: 1,
                        maxDiscount: 1,
                        startDate: 1,
                        expiryDate: 1,
                        isActive: 1,
                        usageLimit: 1,
                        usageCount: { $size: "$usageHistory" }, // Count total usage
                        createdAt: 1,
                        updatedAt: 1
                    }
                },
                { $sort: { createdAt: -1 } } // Sort by creation date, newest first
            ]);
            
            res.render('admin/listCoupon', { coupons });
        } catch (error) {
            console.error('Error in getCoupons:', error);
            res.status(500).json({ error: 'Failed to fetch coupons' });
        }
    },

    createCoupon: async (req, res) => {
        try {
            const { 
                code, 
                description, 
                discountType, 
                discountValue, 
                minPurchase, 
                maxDiscount, 
                startDate, 
                expiryDate, 
                usageLimit 
            } = req.body;

            // Basic validation
            if (!code || !description || !discountType || !discountValue || !expiryDate) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Please fill all required fields' 
                });
            }

            // Validate discount value
            if (discountType === 'PERCENTAGE' && (discountValue <= 0 || discountValue > 100)) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Percentage discount must be between 1 and 100' 
                });
            }

            // Validate dates
            const start = startDate ? new Date(startDate) : new Date();
            const expiry = new Date(expiryDate);
            
            if (expiry <= start) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Expiry date must be after start date' 
                });
            }

            // Check for existing coupon code
            const existingCoupon = await Coupon.findOne({ 
                code: code.toUpperCase().trim() 
            });
            
            if (existingCoupon) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Coupon code already exists' 
                });
            }

            // Create new coupon object
            const couponData = {
                code: code.toUpperCase().trim(),
                description: description.trim(),
                discountType,
                discountValue: Number(discountValue),
                minPurchase: Number(minPurchase) || 0,
                maxDiscount: maxDiscount ? Number(maxDiscount) : null,
                startDate: start,
                expiryDate: expiry,
                usageLimit: Number(usageLimit) || 1,
                isActive: true,
                usageHistory: []
            };

            const coupon = new Coupon(couponData);
            await coupon.save();

            res.status(201).json({ 
                success: true,
                message: 'Coupon created successfully',
                coupon 
            });

        } catch (error) {
            console.error('Error in createCoupon:', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to create coupon',
                details: error.message 
            });
        }
    },

    getCoupon: async (req, res) => {
        try {
            const { id } = req.params;
            const coupon = await Coupon.findById(id);
            
            if (!coupon) {
                return res.status(404).json({ error: 'Coupon not found' });
            }

            res.json(coupon);
        } catch (error) {
            console.error('Error in getCoupon:', error);
            res.status(500).json({ error: 'Failed to fetch coupon details' });
        }
    },

    updateCoupon: async (req, res) => {
        try {
            const { id } = req.params;
            const { 
                code, description, discountType, discountValue, 
                minPurchase, maxDiscount, startDate, expiryDate, usageLimit 
            } = req.body;

            // Validate dates
            if (new Date(expiryDate) <= new Date(startDate)) {
                return res.status(400).json({ error: 'Expiry date must be after start date' });
            }

            // Check for existing coupon code (excluding current coupon)
            const existingCoupon = await Coupon.findOne({ 
                code: code.toUpperCase(),
                _id: { $ne: id }
            });
            if (existingCoupon) {
                return res.status(400).json({ error: 'Coupon code already exists' });
            }

            const coupon = await Coupon.findByIdAndUpdate(
                id,
                {
                    code: code.toUpperCase(),
                    description,
                    discountType,
                    discountValue,
                    minPurchase,
                    maxDiscount: maxDiscount || null,
                    startDate,
                    expiryDate,
                    usageLimit: parseInt(usageLimit)
                },
                { new: true }
            );

            if (!coupon) {
                return res.status(404).json({ error: 'Coupon not found' });
            }

            res.json({ 
                message: 'Coupon updated successfully',
                coupon 
            });
        } catch (error) {
            console.error('Error in updateCoupon:', error);
            res.status(500).json({ error: 'Failed to update coupon' });
        }
    },

    toggleCouponStatus: async (req, res) => {
        try {
            const { id } = req.params;
            const coupon = await Coupon.findById(id);
            
            if (!coupon) {
                return res.status(404).json({ error: 'Coupon not found' });
            }

            coupon.isActive = !coupon.isActive;
            await coupon.save();

            res.json({ 
                message: coupon.isActive ? 'Coupon activated successfully' : 'Coupon deactivated successfully',
                isActive: coupon.isActive 
            });
        } catch (error) {
            console.error('Error in toggleCouponStatus:', error);
            res.status(500).json({ error: 'Failed to update coupon status' });
        }
    },

    deleteCoupon: async (req, res) => {
        try {
            const { id } = req.params;
            const coupon = await Coupon.findByIdAndDelete(id);
            
            if (!coupon) {
                return res.status(404).json({ error: 'Coupon not found' });
            }

            res.json({ message: 'Coupon deleted successfully' });
        } catch (error) {
            console.error('Error in deleteCoupon:', error);
            res.status(500).json({ error: 'Failed to delete coupon' });
        }
    }
};

export default couponController;
