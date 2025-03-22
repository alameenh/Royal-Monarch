import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  brand: { type: String, required: true },
  variant: { type: String, required: true },
  images: [{ path: String, filename: String }],
  quantity: { type: Number, required: true },
  price: { type: Number, required: true },
  discount: { type: Number, default: 0 },
  status: {
    type: String,
    enum: [
      'pending',           // Initial status when order is placed
      'processing',        // Admin started processing the order
      'shipped',          // Order has been shipped
      'delivered',        // Order has been delivered
      'cancelled',        // User cancelled the order
      'order rejected',   // Admin rejected the order
      'return requested', // User requested a return
      'returned',         // Return accepted and completed
      'return rejected'   // Return request was rejected
    ],
    default: 'pending'
  },
  shippedDate: { type: Date },
  deliveredDate: { type: Date },
  cancelledDate: { type: Date },
  returnedDate: { type: Date },
  return: {
    reason: { type: String },
    requestedAt: { type: Date }
  }
});

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    required: true,
    unique: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'users',
    required: true
  },
  items: [orderItemSchema],
  totalAmount: { type: Number, required: true },
  paymentMethod: {
    type: String,
    enum: ['cod', 'online', 'wallet'],
    required: true
  },
  paymentStatus: {
    type: String,
    enum: ['paid', 'unpaid', 'pending', "refunded"],
    default: 'pending'
  },
  shippingAddress: {
    name: { type: String, required: true },
    houseName: { type: String, required: true },
    localityStreet: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
    phone: { type: String, required: true },
    alternatePhone: { type: String }
  },
  orderDate: {
    type: Date,
    default: Date.now
  },
  expectedDeliveryDate: {
    type: Date
  },
  deliveryDate: {
    type: Date
  },
 
  paymentDetails: {
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String }
  }
}, {
  timestamps: true
});

export default mongoose.model('order', orderSchema);