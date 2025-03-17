import User from '../../model/userModel.js';



const getListUser = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const [totalUsers, users] = await Promise.all([
            User.countDocuments(),
            User.find({}, {
                firstname: 1,
                lastname: 1,
                email: 1,
                status: 1,
                createdAt: 1
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
        ]);

        console.log('Users found:', users.length);

        const totalPages = Math.ceil(totalUsers / limit);

        return res.render('admin/listUser', {
            users,
            pagination: {
                currentPage: page,
                totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
                nextPage: page + 1,
                prevPage: page - 1
            }
        });

    } catch (error) {
        console.error('List User Error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Error fetching users' 
        });
    }
};

const updateUserStatus = async (req, res) => {
    try {
        const userId = req.params.id;
        const newStatus = req.body.status;


        if (!["Pending", "Active", "Blocked"].includes(newStatus)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid status value' 
            });
        }

        const user = await User.findByIdAndUpdate(
            userId,
            { status: newStatus },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        res.json({ 
            success: true, 
            message: `User status updated to ${newStatus}`,
            user 
        });

    } catch (error) {
        console.error('Update Status Error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error updating user status' 
        });
    }
};

export default { getListUser, updateUserStatus, };
