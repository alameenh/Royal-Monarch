import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  name: { type: String, required: true },
  brand: { type: String, required: true },
  category: { type: String, required: true },
  images: [{ path: String, filename: String }],
  quantity: { type: Number, required: true },
  originalPrice: { type: Number, required: true },
  variantType: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'return requested', 'returned','refunded','rejected'],
    default: 'pending'
  },
  offer: {
    name: { type: String },
    type: { type: String, enum: ['product', 'category'] },
    discount: { type: Number }
  },
  offerDiscount: { type: Number, default: 0 },
  priceAfterOffer: { type: Number, required: true },
  couponForProduct: {
    code: { type: String },
    discount: { type: Number },
    type: { type: String, enum: ['PERCENTAGE', 'FIXED'] }
  },
  couponDiscount: { type: Number, default: 0 },
  subtotalforproduct: { type: Number, required: true },
  finalAmount: { type: Number, required: true },
  gstAmount: { type: Number, required: true },
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
    enum: ['paid', 'pending', "refunded"],
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
  originalSubtotal: { type: Number, required: true },
  totalOfferDiscount: { type: Number, default: 0 },
  totalCouponDiscount: { type: Number, default: 0 },
  subtotal: { type: Number, required: true },
  gstAmount: { type: Number, required: true },
  shippingCost: { type: Number, required: true },
  coupon: {
    code: { type: String },
    discount: { type: Number },
    type: { 
      type: String,
      enum: ['PERCENTAGE', 'FIXED']
    }
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