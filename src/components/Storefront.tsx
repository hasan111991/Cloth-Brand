import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Heart,
  LogIn,
  LogOut,
  MapPin,
  Menu,
  MessageCircle,
  Minus,
  Package,
  Plus,
  Search,
  Share2,
  ShieldCheck,
  ShoppingBag,
  Star,
  Truck,
  User as UserIcon,
  X,
} from 'lucide-react';
import { ASSETS, resolveAssetUrl } from '../lib/assets';
import { db, handleFirestoreError, makeSafeId, OperationType } from '../lib/firebase';
import {
  formatDate,
  formatDateTime,
  formatPKR,
  isValidPakistaniPhone,
  ORDER_STATUS_LABELS,
  PAKISTAN_CITIES,
} from '../lib/format';
import { placeOrderAtomic } from '../services/businessService';
import {
  AudienceType,
  BusinessSettings,
  CartItem,
  Category,
  Order,
  OrderTracking,
  PaymentMethod,
  Product,
  ProductVariant,
  Review,
  UserProfile,
} from '../types';

export type StorePage =
  | 'home'
  | 'shop'
  | 'product'
  | 'checkout'
  | 'track'
  | 'account'
  | 'about'
  | 'contact'
  | 'faq'
  | 'privacy'
  | 'shipping'
  | 'returns'
  | 'terms';

interface StorefrontProps {
  settings: BusinessSettings;
  categories: Category[];
  products: Product[];
  variants: ProductVariant[];
  currentUser: UserProfile | null;
  authLoading: boolean;
  onGoogleSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onOpenPortal: (portal: 'admin' | 'salesman') => void;
  onOpenWizard: () => void;
}

const FALLBACK_HERO = ASSETS.heroAtelier;
const FALLBACK_CRAFT = ASSETS.craftsmanshipLoom;
const FALLBACK_PRODUCT = ASSETS.productLadiesLawn;

const SafeImage: React.FC<{
  src?: string;
  alt: string;
  className?: string;
}> = ({ src, alt, className = '' }) => {
  const [failed, setFailed] = useState(false);
  const resolved = resolveAssetUrl(src);
  if (!resolved || failed) {
    return (
      <div className={`bg-[#EFECE4] flex flex-col items-center justify-center p-6 text-center ${className}`}>
        <Package className="w-8 h-8 text-[#9A7B3E] mb-2 opacity-70" />
        <span className="text-xs text-[#57534E] font-medium line-clamp-2">{alt}</span>
      </div>
    );
  }
  return (
    <img
      src={resolved}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
};

export const Storefront: React.FC<StorefrontProps> = ({
  settings,
  categories,
  products,
  variants,
  currentUser,
  authLoading,
  onGoogleSignIn,
  onSignOut,
  onOpenPortal,
  onOpenWizard,
}) => {
  const [page, setPage] = useState<StorePage>('home');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [bagOpen, setBagOpen] = useState(false);

  // Catalog filters
  const [searchTerm, setSearchTerm] = useState('');
  const [audienceFilter, setAudienceFilter] = useState<'All' | AudienceType>('All');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [selectedSize, setSelectedSize] = useState('');
  const [selectedColor, setSelectedColor] = useState('');
  const [pdpQty, setPdpQty] = useState(1);

  // Wishlist (persisted locally)
  const [wishlist, setWishlist] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('pakatelier_wishlist');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Shopping Cart
  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem('pakatelier_cart');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Referral code from ?ref=
  const [referralCode, setReferralCode] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get('ref') || localStorage.getItem('pakatelier_ref') || '').toUpperCase();
  });

  useEffect(() => {
    if (referralCode) {
      localStorage.setItem('pakatelier_ref', referralCode);
    }
  }, [referralCode]);

  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get('product');
    if (slug && products.length > 0 && !selectedProduct) {
      const match = products.find((p) => p.slug === slug && p.active);
      if (match) {
        openProductDetail(match);
      }
    }
  }, [products]);

  useEffect(() => {
    localStorage.setItem('pakatelier_cart', JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    localStorage.setItem('pakatelier_wishlist', JSON.stringify(wishlist));
  }, [wishlist]);

  // Reviews for PDP
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSubmitted, setReviewSubmitted] = useState('');

  useEffect(() => {
    if (!selectedProduct) return;
    const q = query(
      collection(db, 'reviews'),
      where('productId', '==', selectedProduct.id),
      where('status', '==', 'APPROVED')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setReviews(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Review, 'id'>) })));
      },
      (err) => {
        console.warn('Reviews listener notice:', err);
      }
    );
    return () => unsub();
  }, [selectedProduct]);

  // Checkout state
  const [ckName, setCkName] = useState(currentUser?.displayName || '');
  const [ckPhone, setCkPhone] = useState(currentUser?.phone || '');
  const [ckCity, setCkCity] = useState(currentUser?.city || 'Lahore');
  const [ckAddress, setCkAddress] = useState(currentUser?.address || '');
  const [ckPaymentMethod, setCkPaymentMethod] = useState<PaymentMethod>(
    settings.paymentMethods[0] || 'COD'
  );
  const [ckTxRef, setCkTxRef] = useState('');
  const [ckProofNote, setCkProofNote] = useState('');
  const [ckCouponInput, setCkCouponInput] = useState('');
  const [ckAppliedDiscount, setCkAppliedDiscount] = useState<{ code: string; amount: number } | null>(null);
  const [ckNotes, setCkNotes] = useState('');
  const [ckError, setCkError] = useState('');
  const [ckSubmitting, setCkSubmitting] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState<{
    orderNumber: string;
    totalAmount: number;
  } | null>(null);

  useEffect(() => {
    if (currentUser) {
      if (!ckName) setCkName(currentUser.displayName || '');
      if (!ckPhone && currentUser.phone) setCkPhone(currentUser.phone);
      if (!ckCity && currentUser.city) setCkCity(currentUser.city);
      if (!ckAddress && currentUser.address) setCkAddress(currentUser.address);
    }
  }, [currentUser]);

  // Customer Order History
  const [myOrders, setMyOrders] = useState<Order[]>([]);
  useEffect(() => {
    if (!currentUser) {
      setMyOrders([]);
      return;
    }
    const q = query(collection(db, 'orders'), where('customerUid', '==', currentUser.uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Order, 'id'>) }))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setMyOrders(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'orders')
    );
    return () => unsub();
  }, [currentUser]);

  // Public Order Tracking
  const [trackInput, setTrackInput] = useState('');
  const [trackedOrder, setTrackedOrder] = useState<OrderTracking | null>(null);
  const [trackError, setTrackError] = useState('');
  const [trackLoading, setTrackLoading] = useState(false);

  const activeProducts = useMemo(() => products.filter((p) => p.active), [products]);

  const filteredProducts = useMemo(() => {
    return activeProducts.filter((p) => {
      if (audienceFilter !== 'All' && p.audience !== 'Both' && p.audience !== audienceFilter) {
        return false;
      }
      if (categoryFilter !== 'all' && p.categoryId !== categoryFilter) {
        return false;
      }
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.categoryName || '').toLowerCase().includes(q) ||
          (p.fabric || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [activeProducts, audienceFilter, categoryFilter, searchTerm]);

  const productVariants = useMemo(() => {
    if (!selectedProduct) return [];
    return variants.filter((v) => v.productId === selectedProduct.id && v.active);
  }, [variants, selectedProduct]);

  const activeVariant = useMemo(() => {
    return (
      productVariants.find((v) => v.size === selectedSize && v.color === selectedColor) ||
      productVariants.find((v) => v.size === selectedSize) ||
      productVariants[0] ||
      null
    );
  }, [productVariants, selectedSize, selectedColor]);

  const openProductDetail = (product: Product) => {
    setSelectedProduct(product);
    setActiveImageIdx(0);
    setPdpQty(1);
    setReviewSubmitted('');
    const pVars = variants.filter((v) => v.productId === product.id && v.active);
    const firstInStock = pVars.find((v) => v.stockAvailable > 0) || pVars[0];
    setSelectedSize(firstInStock?.size || product.sizes[0] || '');
    setSelectedColor(firstInStock?.color || product.colors[0] || '');
    setPage('product');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleWishlist = (productId: string) => {
    setWishlist((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]
    );
  };

  const addToCart = (product: Product, variant: ProductVariant | null, qty: number) => {
    if (!variant) return;
    if (variant.stockAvailable < qty) return;
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.variant.id === variant.id);
      if (idx >= 0) {
        const updated = [...prev];
        const nextQty = Math.min(variant.stockAvailable, updated[idx].quantity + qty);
        updated[idx] = { ...updated[idx], quantity: nextQty, variant };
        return updated;
      }
      return [...prev, { product, variant, quantity: qty }];
    });
    setBagOpen(true);
  };

  const updateCartQty = (variantId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.variant.id !== variantId) return c;
          const next = Math.min(c.variant.stockAvailable, c.quantity + delta);
          return next <= 0 ? null : { ...c, quantity: next };
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartSubtotal = cart.reduce((sum, item) => {
    const base = item.variant.sellingPrice || item.product.sellingPrice;
    const price = Math.round(base * (1 - (item.product.discountPercent || 0) / 100));
    return sum + price * item.quantity;
  }, 0);

  const discountVal = ckAppliedDiscount?.amount || 0;
  const effectiveShipping =
    cartSubtotal === 0
      ? 0
      : settings.freeShippingThreshold > 0 && cartSubtotal - discountVal >= settings.freeShippingThreshold
      ? 0
      : settings.shippingCharges;
  const orderTotal = Math.max(0, cartSubtotal - discountVal + effectiveShipping);

  const handleApplyCoupon = async () => {
    const code = ckCouponInput.trim().toUpperCase();
    if (!code) return;
    setCkError('');
    try {
      const snap = await getDoc(doc(db, 'coupons', code));
      if (!snap.exists()) {
        setCkError(`Coupon "${code}" was not found.`);
        setCkAppliedDiscount(null);
        return;
      }
      const c = snap.data();
      if (!c.active) {
        setCkError(`Coupon "${code}" is no longer active.`);
        return;
      }
      if (c.minOrderAmount && cartSubtotal < c.minOrderAmount) {
        setCkError(`Minimum order of ${formatPKR(c.minOrderAmount)} required for ${code}.`);
        return;
      }
      const amt =
        c.discountType === 'PERCENT'
          ? Math.round((cartSubtotal * Number(c.discountValue)) / 100)
          : Math.min(cartSubtotal, Number(c.discountValue));
      setCkAppliedDiscount({ code, amount: amt });
    } catch {
      setCkError('Could not verify coupon code.');
    }
  };

  const handleCaptureAbandonedCart = async (phone: string) => {
    if (!isValidPakistaniPhone(phone) || cart.length === 0) return;
    try {
      const id = makeSafeId(`cart_${phone.replace(/\D/g, '')}`);
      await setDoc(doc(db, 'abandoned_carts', id), {
        customerName: ckName.slice(0, 120),
        customerPhone: phone.slice(0, 30),
        itemsCount: cartCount,
        totalValue: cartSubtotal,
        recovered: false,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // Non-blocking
    }
  };

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCkError('');
    if (cart.length === 0) {
      setCkError('Your shopping bag is empty.');
      return;
    }
    if (!ckName.trim()) {
      setCkError('Please enter your full name.');
      return;
    }
    if (!isValidPakistaniPhone(ckPhone)) {
      setCkError('Please enter a valid Pakistani mobile number (e.g. 0300-1234567).');
      return;
    }
    if (!ckAddress.trim() || ckAddress.trim().length < 6) {
      setCkError('Please provide your complete delivery street address.');
      return;
    }
    if (ckPaymentMethod === 'BANK_TRANSFER' && !ckTxRef.trim()) {
      setCkError('Please enter your bank / JazzCash / Easypaisa transaction reference.');
      return;
    }

    setCkSubmitting(true);
    try {
      let attributedSalesmanId: string | undefined;
      let attributedSalesmanName: string | undefined;
      if (referralCode) {
        try {
          const sSnap = await getDocs(
            query(collection(db, 'salesmen'), where('referralCode', '==', referralCode))
          );
          if (!sSnap.empty) {
            const sDoc = sSnap.docs[0];
            attributedSalesmanId = sDoc.id;
            attributedSalesmanName = String(sDoc.data().name || '');
          }
        } catch {
          // Salesman lookup may be restricted for guests; referralCode still captured
        }
      }

      const result = await placeOrderAtomic({
        items: cart,
        customerUid: currentUser?.uid,
        customerName: ckName.trim(),
        customerPhone: ckPhone.trim(),
        customerCity: ckCity,
        customerAddress: ckAddress.trim(),
        paymentMethod: ckPaymentMethod,
        transactionRef: ckTxRef.trim(),
        proofNote: ckProofNote.trim(),
        couponCode: ckAppliedDiscount?.code,
        referralCode: referralCode || undefined,
        salesmanId: attributedSalesmanId,
        salesmanName: attributedSalesmanName,
        source: 'WEBSITE',
        shippingCharges: settings.shippingCharges,
        freeShippingThreshold: settings.freeShippingThreshold,
        notes: ckNotes.trim(),
      });

      setCart([]);
      setCkAppliedDiscount(null);
      setConfirmedOrder({
        orderNumber: result.orderNumber,
        totalAmount: result.totalAmount,
      });
    } catch (err) {
      setCkError(err instanceof Error ? err.message : 'Unable to place order.');
    } finally {
      setCkSubmitting(false);
    }
  };

  const handleTrackOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = trackInput.trim().toUpperCase();
    if (!num) return;
    setTrackLoading(true);
    setTrackError('');
    setTrackedOrder(null);
    try {
      const snap = await getDoc(doc(db, 'order_tracking', num));
      if (!snap.exists()) {
        setTrackError(`No order found with number "${num}". Please verify your order ID.`);
      } else {
        setTrackedOrder({ id: snap.id, ...(snap.data() as Omit<OrderTracking, 'id'>) });
      }
    } catch {
      setTrackError('Unable to retrieve order tracking details.');
    } finally {
      setTrackLoading(false);
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct || !currentUser || !reviewComment.trim()) return;
    try {
      const id = makeSafeId(`rev_${selectedProduct.id}_${currentUser.uid}_${Date.now()}`);
      await setDoc(doc(db, 'reviews', id), {
        productId: selectedProduct.id,
        customerUid: currentUser.uid,
        customerName: currentUser.displayName,
        rating: reviewRating,
        comment: reviewComment.trim().slice(0, 800),
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      });
      setReviewComment('');
      setReviewSubmitted('Thank you. Your review has been submitted for moderation.');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'reviews');
    }
  };

  const handleShareProduct = (product: Product) => {
    const url = `${window.location.origin}/?product=${product.slug}${
      referralCode ? `&ref=${referralCode}` : ''
    }`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
  };

  const whatsappHref = (text: string) => {
    const num = (settings.whatsappNumber || '').replace(/\D/g, '');
    if (!num) return '#contact';
    return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
  };

  const navTo = (target: StorePage) => {
    setConfirmedOrder(null);
    setPage(target);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const isStaff =
    currentUser &&
    ['OWNER', 'ADMIN', 'SALES_MANAGER', 'INVENTORY_MANAGER', 'PACKING_STAFF'].includes(
      currentUser.role
    );
  const isSalesmanUser = currentUser?.role === 'SALESMAN' || currentUser?.role === 'OWNER';

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF9F6] text-[#141413]">
      {/* Slim Setup Prompt Banner ONLY for Owner if setup not yet completed */}
      {!settings.setupCompleted && currentUser?.role === 'OWNER' && (
        <div
          className="text-white text-xs py-2 px-4 flex items-center justify-between gap-4"
          style={{ backgroundColor: settings.primaryColor || '#0F3D2E' }}
        >
          <span>Business configuration is pending. Complete the setup wizard to customize your brand, couriers, and payment instructions.</span>
          <button
            type="button"
            onClick={onOpenWizard}
            className="underline font-semibold whitespace-nowrap shrink-0"
          >
            Launch Setup Wizard
          </button>
        </div>
      )}

      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 bg-[#FAF9F6]/95 backdrop-blur-sm border-b border-[#E6E1D6]">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-element Brand Wordmark */}
          <button
            type="button"
            onClick={() => navTo('home')}
            className="font-serif text-2xl font-semibold tracking-tight text-[#141413] whitespace-nowrap shrink-0 cursor-pointer"
          >
            {settings.brandName || 'PakAtelier'}
          </button>

          {/* Zone 2: 5 concise single-line nav links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#57534E]">
            <button
              type="button"
              onClick={() => navTo('shop')}
              className={`hover:text-[#141413] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                page === 'shop' ? 'text-[#141413] underline underline-offset-4' : ''
              }`}
            >
              Shop
            </button>
            <button
              type="button"
              onClick={() => navTo('track')}
              className={`hover:text-[#141413] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                page === 'track' ? 'text-[#141413] underline underline-offset-4' : ''
              }`}
            >
              Track Order
            </button>
            <button
              type="button"
              onClick={() => navTo('about')}
              className={`hover:text-[#141413] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                page === 'about' ? 'text-[#141413] underline underline-offset-4' : ''
              }`}
            >
              About
            </button>
            <button
              type="button"
              onClick={() => navTo('contact')}
              className={`hover:text-[#141413] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                page === 'contact' ? 'text-[#141413] underline underline-offset-4' : ''
              }`}
            >
              Contact
            </button>
            <button
              type="button"
              onClick={() => navTo('account')}
              className={`hover:text-[#141413] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                page === 'account' ? 'text-[#141413] underline underline-offset-4' : ''
              }`}
            >
              {currentUser ? 'Account' : 'Sign In'}
            </button>
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setBagOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white rounded-lg transition-opacity hover:opacity-90 whitespace-nowrap shrink-0 cursor-pointer"
              style={{ backgroundColor: settings.primaryColor || '#0F3D2E' }}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span className="tabular-nums">Bag ({cartCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 text-[#141413] rounded-lg border border-[#E6E1D6]"
              aria-label="Toggle navigation"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Mobile Nav Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-[#E6E1D6] bg-[#FAF9F6] px-4 py-3 flex flex-col gap-2 text-sm font-medium">
            <button type="button" onClick={() => navTo('shop')} className="py-2 text-left">
              Shop Collection
            </button>
            <button type="button" onClick={() => navTo('track')} className="py-2 text-left">
              Track Order
            </button>
            <button type="button" onClick={() => navTo('about')} className="py-2 text-left">
              About Us
            </button>
            <button type="button" onClick={() => navTo('contact')} className="py-2 text-left">
              Contact & WhatsApp
            </button>
            <button type="button" onClick={() => navTo('account')} className="py-2 text-left">
              {currentUser ? `Account (${currentUser.displayName})` : 'Customer Sign In'}
            </button>
          </div>
        )}
      </header>

      {/* Main Storefront Content */}
      <main className="flex-1">
        {/* HOME PAGE */}
        {page === 'home' && (
          <div>
            {/* Section 1: Editorial Hero Split */}
            <section className="max-w-7xl mx-auto px-4 sm:px-8 py-10 lg:py-16">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
                <div className="lg:col-span-5 flex flex-col justify-center space-y-6">
                  <p className="text-xs tracking-wider uppercase text-[#78716C] font-medium">
                    {settings.audienceType === 'Both'
                      ? 'Ladies & Gents Apparel · Pakistan'
                      : `${settings.audienceType} Apparel · Pakistan`}
                  </p>
                  <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl font-semibold text-[#141413] leading-[1.08] text-balance">
                    {settings.tagline || 'Contemporary Pakistani Apparel & Textile Craft'}
                  </h1>
                  <p className="text-base text-[#57534E] leading-relaxed max-w-lg">
                    {settings.aboutText}
                  </p>
                  <div className="flex flex-wrap items-center gap-4 pt-2">
                    <button
                      type="button"
                      onClick={() => navTo('shop')}
                      className="px-6 py-3 text-sm font-medium text-white rounded-lg inline-flex items-center gap-2 transition-opacity hover:opacity-90 cursor-pointer"
                      style={{ backgroundColor: settings.primaryColor || '#0F3D2E' }}
                    >
                      Explore Collection <ArrowRight className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => navTo('track')}
                      className="px-5 py-3 text-sm font-medium border border-[#D6D0C4] text-[#141413] rounded-lg hover:bg-[#F2EFE9] transition-colors cursor-pointer"
                    >
                      Track Order
                    </button>
                  </div>
                  <div className="pt-4 border-t border-[#E6E1D6] flex flex-wrap gap-x-6 gap-y-2 text-xs text-[#57534E]">
                    <span>Cash on Delivery Nationwide</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {settings.freeShippingThreshold > 0
                        ? `Free Shipping Above ${formatPKR(settings.freeShippingThreshold)}`
                        : `Standard Shipping ${formatPKR(settings.shippingCharges)}`}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>7-Day Exchange Policy</span>
                  </div>
                </div>

                <div className="lg:col-span-7">
                  <div className="aspect-[16/10] lg:h-full rounded-xl overflow-hidden border border-[#E6E1D6] bg-[#EFECE4]">
                    <SafeImage
                      src={FALLBACK_HERO}
                      alt={`${settings.brandName} Atelier Showcase`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* Section 2: Featured Collection Grid */}
            <section className="max-w-7xl mx-auto px-4 sm:px-8 py-12 border-t border-[#E6E1D6]">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
                <div>
                  <h2 className="font-serif text-3xl font-semibold text-[#141413]">
                    Featured Releases
                  </h2>
                  <p className="text-sm text-[#57534E] mt-1">
                    Live warehouse stock with direct nationwide courier dispatch.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navTo('shop')}
                  className="text-sm font-medium text-[#141413] underline underline-offset-4 hover:opacity-75 whitespace-nowrap cursor-pointer"
                >
                  View Full Catalog ({activeProducts.length})
                </button>
              </div>

              {activeProducts.length === 0 ? (
                <div className="bg-white border border-[#E6E1D6] rounded-xl p-12 text-center space-y-3">
                  <Package className="w-8 h-8 text-[#9A7B3E] mx-auto" />
                  <h3 className="font-serif text-2xl font-medium text-[#141413]">
                    Catalog Awaiting Inventory
                  </h3>
                  <p className="text-sm text-[#57534E] max-w-md mx-auto">
                    Products added in the Owner & Inventory dashboard appear here automatically with real-time stock counts.
                  </p>
                  {isStaff && (
                    <button
                      type="button"
                      onClick={() => onOpenPortal('admin')}
                      className="mt-2 px-5 py-2.5 text-xs font-medium bg-[#0F3D2E] text-white rounded-lg"
                    >
                      Open Owner Dashboard to Add Products
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                  {activeProducts.slice(0, 6).map((product) => {
                    const hasDiscount = (product.discountPercent || 0) > 0;
                    const finalPrice = Math.round(
                      product.sellingPrice * (1 - (product.discountPercent || 0) / 100)
                    );
                    const inStock = (product.totalAvailable || 0) > 0;
                    return (
                      <article
                        key={product.id}
                        className="group cursor-pointer flex flex-col"
                        onClick={() => openProductDetail(product)}
                      >
                        <div className="aspect-[4/3] rounded-xl overflow-hidden bg-[#EFECE4] border border-[#E6E1D6] mb-3.5 relative">
                          <SafeImage
                            src={product.images[0] || FALLBACK_PRODUCT}
                            alt={product.name}
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                          />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleWishlist(product.id);
                            }}
                            aria-label="Toggle wishlist"
                            className="absolute top-3 right-3 p-2 rounded-full bg-white/90 text-[#141413] hover:bg-white transition-colors"
                          >
                            <Heart
                              className={`w-4 h-4 ${
                                wishlist.includes(product.id) ? 'fill-red-600 text-red-600' : ''
                              }`}
                            />
                          </button>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-[#78716C] mb-1">
                          <span>{product.categoryName || 'Collection'}</span>
                          <span aria-hidden="true">·</span>
                          <span>{product.audience}</span>
                          <span aria-hidden="true">·</span>
                          <span className={inStock ? 'text-[#0F3D2E] font-medium' : 'text-red-700 font-medium'}>
                            {inStock ? 'In Stock' : 'Out of Stock'}
                          </span>
                        </div>

                        <h3 className="text-base font-semibold text-[#141413] group-hover:underline underline-offset-4">
                          {product.name}
                        </h3>

                        <div className="mt-1 flex items-baseline gap-2 tabular-nums">
                          <span className="text-sm font-semibold text-[#141413]">
                            {formatPKR(finalPrice)}
                          </span>
                          {hasDiscount && (
                            <span className="text-xs text-[#78716C] line-through">
                              {formatPKR(product.sellingPrice)}
                            </span>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Section 3: Craftsmanship & Provenance */}
            <section className="max-w-7xl mx-auto px-4 sm:px-8 py-14 border-t border-[#E6E1D6]">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
                <div className="lg:col-span-6 aspect-[16/10] rounded-xl overflow-hidden border border-[#E6E1D6]">
                  <SafeImage
                    src={FALLBACK_CRAFT}
                    alt="Pakistani textile artisan embroidery craft"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="lg:col-span-6 space-y-5">
                  <p className="text-xs uppercase tracking-wider text-[#78716C] font-medium">
                    Craftsmanship & Service
                  </p>
                  <h2 className="font-serif text-3xl sm:text-4xl font-semibold text-[#141413] text-balance">
                    Woven & Finished Across Faisalabad and Lahore
                  </h2>
                  <p className="text-sm text-[#57534E] leading-relaxed">
                    Every batch is inspected before dispatch. Orders placed online or via WhatsApp reserve real warehouse inventory immediately to prevent overselling, with live courier tracking across {settings.deliveryCoverage}.
                  </p>
                  <div className="grid grid-cols-2 gap-4 pt-2 border-t border-[#E6E1D6] text-xs">
                    <div>
                      <p className="font-semibold text-[#141413]">Courier Partners</p>
                      <p className="text-[#57534E] mt-1">{settings.courierProviders.join(' · ')}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-[#141413]">Payment Options</p>
                      <p className="text-[#57534E] mt-1">
                        {settings.paymentMethods
                          .map((m) => (m === 'COD' ? 'Cash on Delivery' : 'Bank Transfer'))
                          .join(' · ')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* SHOP & CATEGORIES PAGE */}
        {page === 'shop' && (
          <section className="max-w-7xl mx-auto px-4 sm:px-8 py-10 space-y-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h1 className="font-serif text-4xl font-semibold text-[#141413]">
                  Shop Collection
                </h1>
                <p className="text-sm text-[#57534E] mt-1">
                  Showing {filteredProducts.length} active garments · Prices in PKR
                </p>
              </div>

              <div className="relative w-full md:w-80">
                <Search className="w-4 h-4 text-[#78716C] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by title, SKU, or fabric..."
                  className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-[#D6D0C4] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F3D2E]"
                />
              </div>
            </div>

            {/* Interactive Filter Controls */}
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#E6E1D6]">
              <div className="flex items-center gap-1 p-1 bg-[#EFECE4] rounded-lg">
                {(['All', 'Ladies', 'Gents'] as const).map((aud) => (
                  <button
                    key={aud}
                    type="button"
                    onClick={() => setAudienceFilter(aud)}
                    className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      audienceFilter === aud
                        ? 'bg-white text-[#141413] shadow-xs'
                        : 'text-[#57534E] hover:text-[#141413]'
                    }`}
                  >
                    {aud}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCategoryFilter('all')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    categoryFilter === 'all'
                      ? 'bg-[#141413] text-white border-[#141413]'
                      : 'bg-white text-[#57534E] border-[#D6D0C4] hover:text-[#141413]'
                  }`}
                >
                  All Categories
                </button>
                {categories
                  .filter((c) => c.active)
                  .map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCategoryFilter(cat.id)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                        categoryFilter === cat.id
                          ? 'bg-[#141413] text-white border-[#141413]'
                          : 'bg-white text-[#57534E] border-[#D6D0C4] hover:text-[#141413]'
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
              </div>
            </div>

            {filteredProducts.length === 0 ? (
              <div className="bg-white border border-[#E6E1D6] rounded-xl p-12 text-center">
                <p className="text-sm text-[#57534E]">
                  No garments matched your current filter. Clear search or choose another category.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                {filteredProducts.map((product) => {
                  const hasDiscount = (product.discountPercent || 0) > 0;
                  const finalPrice = Math.round(
                    product.sellingPrice * (1 - (product.discountPercent || 0) / 100)
                  );
                  const inStock = (product.totalAvailable || 0) > 0;
                  return (
                    <article
                      key={product.id}
                      onClick={() => openProductDetail(product)}
                      className="group cursor-pointer flex flex-col"
                    >
                      <div className="aspect-[4/3] rounded-xl overflow-hidden bg-[#EFECE4] border border-[#E6E1D6] mb-3.5 relative">
                        <SafeImage
                          src={product.images[0] || FALLBACK_PRODUCT}
                          alt={product.name}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                      </div>
                      <div className="flex items-center gap-2 text-xs text-[#78716C] mb-1">
                        <span>{product.categoryName || 'Apparel'}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{product.sku}</span>
                        <span aria-hidden="true">·</span>
                        <span className={inStock ? 'text-[#0F3D2E] font-medium' : 'text-red-700 font-medium'}>
                          {inStock ? `${product.totalAvailable} in stock` : 'Out of Stock'}
                        </span>
                      </div>
                      <h3 className="text-base font-semibold text-[#141413] group-hover:underline underline-offset-4">
                        {product.name}
                      </h3>
                      <div className="mt-1 flex items-baseline gap-2 tabular-nums">
                        <span className="text-sm font-semibold text-[#141413]">
                          {formatPKR(finalPrice)}
                        </span>
                        {hasDiscount && (
                          <span className="text-xs text-[#78716C] line-through">
                            {formatPKR(product.sellingPrice)}
                          </span>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* PRODUCT DETAIL PAGE (PDP) */}
        {page === 'product' && selectedProduct && (
          <section className="max-w-7xl mx-auto px-4 sm:px-8 py-10 space-y-12">
            <button
              type="button"
              onClick={() => navTo('shop')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#57534E] hover:text-[#141413] cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Shop
            </button>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
              {/* Gallery */}
              <div className="lg:col-span-7 space-y-4">
                <div className="aspect-[4/3] rounded-xl overflow-hidden bg-[#EFECE4] border border-[#E6E1D6]">
                  <SafeImage
                    src={selectedProduct.images[activeImageIdx] || selectedProduct.images[0] || FALLBACK_PRODUCT}
                    alt={selectedProduct.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                {selectedProduct.images.length > 1 && (
                  <div className="grid grid-cols-4 gap-3">
                    {selectedProduct.images.map((img, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setActiveImageIdx(i)}
                        className={`aspect-[4/3] rounded-lg overflow-hidden border-2 transition-colors ${
                          i === activeImageIdx ? 'border-[#0F3D2E]' : 'border-[#E6E1D6]'
                        }`}
                      >
                        <SafeImage src={img} alt={`${selectedProduct.name} view ${i + 1}`} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Contiguous Purchase Module */}
              <div className="lg:col-span-5 bg-white border border-[#E6E1D6] rounded-xl p-6 sm:p-8 space-y-6">
                <div>
                  <div className="flex items-center gap-2 text-xs text-[#78716C] mb-2">
                    <span>{selectedProduct.categoryName || 'Apparel'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{selectedProduct.audience}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{activeVariant?.sku || selectedProduct.sku}</span>
                  </div>
                  <h1 className="font-serif text-3xl font-semibold text-[#141413]">
                    {selectedProduct.name}
                  </h1>
                  <div className="mt-3 flex items-baseline gap-3 tabular-nums">
                    <span className="text-2xl font-semibold text-[#141413]">
                      {formatPKR(
                        Math.round(
                          (activeVariant?.sellingPrice || selectedProduct.sellingPrice) *
                            (1 - (selectedProduct.discountPercent || 0) / 100)
                        )
                      )}
                    </span>
                    {(selectedProduct.discountPercent || 0) > 0 && (
                      <>
                        <span className="text-sm text-[#78716C] line-through">
                          {formatPKR(activeVariant?.sellingPrice || selectedProduct.sellingPrice)}
                        </span>
                        <span className="text-xs font-medium text-[#0F3D2E]">
                          {selectedProduct.discountPercent}% off
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {selectedProduct.fabric && (
                  <p className="text-xs text-[#57534E] border-y border-[#E6E1D6] py-3">
                    <span className="font-semibold text-[#141413]">Fabric:</span> {selectedProduct.fabric}
                  </p>
                )}

                <p className="text-sm text-[#57534E] leading-relaxed">
                  {selectedProduct.description}
                </p>

                {/* Size Selector */}
                <div className="space-y-2">
                  <span className="block text-xs font-semibold text-[#141413]">Size</span>
                  <div className="flex flex-wrap gap-2">
                    {Array.from(new Set(productVariants.map((v) => v.size))).map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => setSelectedSize(sz)}
                        className={`px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                          selectedSize === sz
                            ? 'bg-[#141413] text-white border-[#141413]'
                            : 'bg-white text-[#141413] border-[#D6D0C4] hover:border-[#141413]'
                        }`}
                      >
                        {sz}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Color Selector */}
                <div className="space-y-2">
                  <span className="block text-xs font-semibold text-[#141413]">Color</span>
                  <div className="flex flex-wrap gap-2">
                    {Array.from(new Set(productVariants.map((v) => v.color))).map((col) => (
                      <button
                        key={col}
                        type="button"
                        onClick={() => setSelectedColor(col)}
                        className={`px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                          selectedColor === col
                            ? 'bg-[#141413] text-white border-[#141413]'
                            : 'bg-white text-[#141413] border-[#D6D0C4] hover:border-[#141413]'
                        }`}
                      >
                        {col}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Stock Status & Quantity */}
                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs font-medium">
                    {activeVariant && activeVariant.stockAvailable > 0 ? (
                      <span className="text-[#0F3D2E]">
                        In Stock ({activeVariant.stockAvailable} available)
                      </span>
                    ) : (
                      <span className="text-red-700">Currently Out of Stock</span>
                    )}
                  </span>

                  <div className="inline-flex items-center border border-[#D6D0C4] rounded-lg">
                    <button
                      type="button"
                      onClick={() => setPdpQty((q) => Math.max(1, q - 1))}
                      className="p-2 text-[#57534E] hover:text-[#141413]"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="px-3 text-sm font-medium tabular-nums">{pdpQty}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setPdpQty((q) =>
                          Math.min(activeVariant?.stockAvailable || 1, q + 1)
                        )
                      }
                      className="p-2 text-[#57534E] hover:text-[#141413]"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="space-y-2.5 pt-2">
                  <button
                    type="button"
                    disabled={!activeVariant || activeVariant.stockAvailable < 1}
                    onClick={() => addToCart(selectedProduct, activeVariant, pdpQty)}
                    className="w-full py-3 px-5 text-sm font-medium text-white rounded-lg disabled:opacity-40 transition-opacity cursor-pointer"
                    style={{ backgroundColor: settings.primaryColor || '#0F3D2E' }}
                  >
                    {activeVariant && activeVariant.stockAvailable > 0
                      ? 'Add to Shopping Bag'
                      : 'Out of Stock'}
                  </button>

                  <div className="grid grid-cols-2 gap-2.5">
                    <a
                      href={whatsappHref(
                        `Assalam-o-Alaikum, I would like to inquire about ${selectedProduct.name} (${
                          activeVariant?.sku || selectedProduct.sku
                        }).`
                      )}
                      target="_blank"
                      rel="noreferrer"
                      className="py-2.5 px-3 text-xs font-medium border border-[#D6D0C4] rounded-lg text-[#141413] hover:bg-[#F2EFE9] inline-flex items-center justify-center gap-1.5"
                    >
                      <MessageCircle className="w-3.5 h-3.5" /> WhatsApp Order
                    </a>
                    <button
                      type="button"
                      onClick={() => handleShareProduct(selectedProduct)}
                      className="py-2.5 px-3 text-xs font-medium border border-[#D6D0C4] rounded-lg text-[#141413] hover:bg-[#F2EFE9] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Share2 className="w-3.5 h-3.5" /> Copy Share Link
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Customer Reviews & Moderation */}
            <div className="border-t border-[#E6E1D6] pt-10 grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-7 space-y-4">
                <h2 className="font-serif text-2xl font-semibold text-[#141413]">
                  Customer Reviews ({reviews.length})
                </h2>
                {reviews.length === 0 ? (
                  <p className="text-sm text-[#57534E]">
                    No approved reviews yet for this garment.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {reviews.map((rev) => (
                      <div key={rev.id} className="bg-white border border-[#E6E1D6] rounded-xl p-5">
                        <div className="flex items-center justify-between text-xs text-[#78716C] mb-2">
                          <span className="font-semibold text-[#141413]">{rev.customerName}</span>
                          <span>{formatDate(rev.createdAt)}</span>
                        </div>
                        <div className="flex items-center gap-1 mb-2">
                          {Array.from({ length: rev.rating }).map((_, idx) => (
                            <Star key={idx} className="w-3.5 h-3.5 fill-[#9A7B3E] text-[#9A7B3E]" />
                          ))}
                        </div>
                        <p className="text-sm text-[#57534E]">{rev.comment}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="lg:col-span-5 bg-white border border-[#E6E1D6] rounded-xl p-6 space-y-4">
                <h3 className="text-sm font-semibold text-[#141413]">Write a Review</h3>
                {!currentUser ? (
                  <div className="space-y-3">
                    <p className="text-xs text-[#57534E]">
                      Sign in with Google to leave a verified customer review.
                    </p>
                    <button
                      type="button"
                      onClick={onGoogleSignIn}
                      className="px-4 py-2 text-xs font-medium bg-[#141413] text-white rounded-lg"
                    >
                      Sign In to Review
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmitReview} className="space-y-3">
                    <div>
                      <label className="block text-xs text-[#57534E] mb-1">Rating</label>
                      <select
                        value={reviewRating}
                        onChange={(e) => setReviewRating(Number(e.target.value))}
                        className="w-full px-3 py-2 text-sm border border-[#D6D0C4] rounded-lg bg-white"
                      >
                        <option value={5}>5 — Exceptional</option>
                        <option value={4}>4 — Very Good</option>
                        <option value={3}>3 — Satisfactory</option>
                        <option value={2}>2 — Needs Improvement</option>
                        <option value={1}>1 — Poor</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-[#57534E] mb-1">Your Feedback</label>
                      <textarea
                        rows={3}
                        required
                        value={reviewComment}
                        onChange={(e) => setReviewComment(e.target.value)}
                        placeholder="Share fabric quality, stitching, and fit experience..."
                        className="w-full px-3 py-2 text-sm border border-[#D6D0C4] rounded-lg"
                      />
                    </div>
                    {reviewSubmitted && (
                      <p className="text-xs text-emerald-700 font-medium">{reviewSubmitted}</p>
                    )}
                    <button
                      type="submit"
                      className="px-4 py-2 text-xs font-medium bg-[#0F3D2E] text-white rounded-lg"
                    >
                      Submit Review
                    </button>
                  </form>
                )}
              </div>
            </div>

            {/* Related Products */}
            {activeProducts.filter((p) => p.id !== selectedProduct.id).length > 0 && (
              <div className="border-t border-[#E6E1D6] pt-10 space-y-6">
                <h2 className="font-serif text-2xl font-semibold text-[#141413]">
                  Related Garments
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  {activeProducts
                    .filter((p) => p.id !== selectedProduct.id)
                    .slice(0, 3)
                    .map((rel) => (
                      <div
                        key={rel.id}
                        onClick={() => openProductDetail(rel)}
                        className="cursor-pointer group"
                      >
                        <div className="aspect-[4/3] rounded-xl overflow-hidden bg-[#EFECE4] border border-[#E6E1D6] mb-2">
                          <SafeImage
                            src={rel.images[0] || FALLBACK_PRODUCT}
                            alt={rel.name}
                            className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform"
                          />
                        </div>
                        <p className="text-sm font-semibold text-[#141413]">{rel.name}</p>
                        <p className="text-xs text-[#57534E] tabular-nums">{formatPKR(rel.sellingPrice)}</p>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* CHECKOUT PAGE */}
        {page === 'checkout' && (
          <section className="max-w-6xl mx-auto px-4 sm:px-8 py-10">
            {confirmedOrder ? (
              <div className="max-w-xl mx-auto bg-white border border-[#E6E1D6] rounded-xl p-8 text-center space-y-5">
                <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto">
                  <Check className="w-6 h-6" />
                </div>
                <h1 className="font-serif text-3xl font-semibold text-[#141413]">
                  Order {confirmedOrder.orderNumber} Confirmed
                </h1>
                <p className="text-sm text-[#57534E]">
                  Your order has been logged in our system and stock has been reserved. Total payable:{' '}
                  <span className="font-semibold text-[#141413] tabular-nums">
                    {formatPKR(confirmedOrder.totalAmount)}
                  </span>
                </p>
                <div className="flex flex-wrap justify-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTrackInput(confirmedOrder.orderNumber);
                      navTo('track');
                    }}
                    className="px-5 py-2.5 text-xs font-medium bg-[#0F3D2E] text-white rounded-lg"
                  >
                    Track Order Status
                  </button>
                  <button
                    type="button"
                    onClick={() => navTo('shop')}
                    className="px-5 py-2.5 text-xs font-medium border border-[#D6D0C4] rounded-lg"
                  >
                    Continue Shopping
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                <form
                  onSubmit={handleCheckoutSubmit}
                  className="lg:col-span-7 bg-white border border-[#E6E1D6] rounded-xl p-6 sm:p-8 space-y-6"
                >
                  <div className="flex items-center justify-between">
                    <h1 className="font-serif text-3xl font-semibold text-[#141413]">
                      Checkout
                    </h1>
                    <span className="text-xs text-[#57534E]">
                      {currentUser ? `Signed in as ${currentUser.displayName}` : 'Guest Checkout'}
                    </span>
                  </div>

                  {ckError && (
                    <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                      {ckError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-[#57534E] mb-1">
                        Full Name
                      </label>
                      <input
                        type="text"
                        required
                        value={ckName}
                        onChange={(e) => setCkName(e.target.value)}
                        placeholder="Ayesha Khan"
                        className="w-full px-3 py-2 text-sm border border-[#D6D0C4] rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#57534E] mb-1">
                        Pakistani Mobile Number
                      </label>
                      <input
                        type="tel"
                        required
                        value={ckPhone}
                        onChange={(e) => setCkPhone(e.target.value)}
                        onBlur={(e) => handleCaptureAbandonedCart(e.target.value)}
                        placeholder="0300-1234567"
                        className="w-full px-3 py-2 text-sm border border-[#D6D0C4] rounded-lg font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-[#57534E] mb-1">
                        City
                      </label>
                      <select
                        value={ckCity}
                        onChange={(e) => setCkCity(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-[#D6D0C4] rounded-lg bg-white"
                      >
                        {PAKISTAN_CITIES.map((city) => (
                          <option key={city} value={city}>
                            {city}
                          </option>
                        ))}
                        <option value="Other">Other City</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#57534E] mb-1">
                        Salesman Referral Code (optional)
                      </label>
                      <input
                        type="text"
                        value={referralCode}
                        onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                        placeholder="e.g. ZAYR01"
                        className="w-full px-3 py-2 text-sm border border-[#D6D0C4] rounded-lg font-mono uppercase"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#57534E] mb-1">
                      Complete Delivery Address (House, Street, Sector/Block)
                    </label>
                    <textarea
                      rows={2}
                      required
                      value={ckAddress}
                      onChange={(e) => setCkAddress(e.target.value)}
                      placeholder="House 14-B, Street 7, Gulberg III, Lahore"
                      className="w-full px-3 py-2 text-sm border border-[#D6D0C4] rounded-lg"
                    />
                  </div>

                  <div className="space-y-2.5 pt-2 border-t border-[#E6E1D6]">
                    <label className="block text-xs font-semibold text-[#141413]">
                      Payment Method
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {settings.paymentMethods.includes('COD') && (
                        <button
                          type="button"
                          onClick={() => setCkPaymentMethod('COD')}
                          className={`p-3.5 text-left rounded-lg border transition-colors ${
                            ckPaymentMethod === 'COD'
                              ? 'border-[#0F3D2E] bg-[#0F3D2E]/5'
                              : 'border-[#D6D0C4]'
                          }`}
                        >
                          <p className="text-sm font-semibold text-[#141413]">Cash on Delivery (COD)</p>
                          <p className="text-xs text-[#57534E] mt-0.5">
                            Pay cash to courier rider upon parcel delivery
                          </p>
                        </button>
                      )}
                      {settings.paymentMethods.includes('BANK_TRANSFER') && (
                        <button
                          type="button"
                          onClick={() => setCkPaymentMethod('BANK_TRANSFER')}
                          className={`p-3.5 text-left rounded-lg border transition-colors ${
                            ckPaymentMethod === 'BANK_TRANSFER'
                              ? 'border-[#0F3D2E] bg-[#0F3D2E]/5'
                              : 'border-[#D6D0C4]'
                          }`}
                        >
                          <p className="text-sm font-semibold text-[#141413]">Manual Bank Transfer</p>
                          <p className="text-xs text-[#57534E] mt-0.5">
                            IBAN / JazzCash / Easypaisa with verification
                          </p>
                        </button>
                      )}
                    </div>

                    {ckPaymentMethod === 'BANK_TRANSFER' && (
                      <div className="mt-3 p-4 bg-[#F5F2EB] border border-[#E6E1D6] rounded-lg space-y-3">
                        <p className="text-xs text-[#141413] font-medium">
                          Transfer Instructions:
                        </p>
                        <p className="text-xs text-[#57534E] font-mono whitespace-pre-wrap">
                          {settings.bankDetails}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-[#57534E] mb-1">
                              Transaction ID / Reference
                            </label>
                            <input
                              type="text"
                              required
                              value={ckTxRef}
                              onChange={(e) => setCkTxRef(e.target.value)}
                              placeholder="TID / IBFT Ref #"
                              className="w-full px-3 py-2 text-xs font-mono bg-white border border-[#D6D0C4] rounded-lg"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-[#57534E] mb-1">
                              Sender Bank / Proof Note
                            </label>
                            <input
                              type="text"
                              value={ckProofNote}
                              onChange={(e) => setCkProofNote(e.target.value)}
                              placeholder="Sender name or account last 4 digits"
                              className="w-full px-3 py-2 text-xs bg-white border border-[#D6D0C4] rounded-lg"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#57534E] mb-1">
                      Delivery Instructions (optional)
                    </label>
                    <input
                      type="text"
                      value={ckNotes}
                      onChange={(e) => setCkNotes(e.target.value)}
                      placeholder="Call before delivery, evening hours, etc."
                      className="w-full px-3 py-2 text-sm border border-[#D6D0C4] rounded-lg"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={ckSubmitting || cart.length === 0}
                    className="w-full py-3.5 text-sm font-medium text-white rounded-lg disabled:opacity-40 cursor-pointer"
                    style={{ backgroundColor: settings.primaryColor || '#0F3D2E' }}
                  >
                    {ckSubmitting
                      ? 'Confirming Order & Reserving Stock...'
                      : `Place Order · ${formatPKR(orderTotal)}`}
                  </button>
                </form>

                {/* Order Summary Sidebar */}
                <aside className="lg:col-span-5 bg-white border border-[#E6E1D6] rounded-xl p-6 space-y-5">
                  <h2 className="font-serif text-xl font-semibold text-[#141413]">
                    Order Summary
                  </h2>
                  <div className="divide-y divide-[#E6E1D6]">
                    {cart.map((item) => {
                      const base = item.variant.sellingPrice || item.product.sellingPrice;
                      const unit = Math.round(base * (1 - (item.product.discountPercent || 0) / 100));
                      return (
                        <div key={item.variant.id} className="py-3 flex justify-between gap-3 text-sm">
                          <div>
                            <p className="font-medium text-[#141413]">{item.product.name}</p>
                            <p className="text-xs text-[#78716C]">
                              {item.variant.size} · {item.variant.color} · Qty {item.quantity}
                            </p>
                          </div>
                          <span className="font-medium tabular-nums">
                            {formatPKR(unit * item.quantity)}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Coupon Box */}
                  <div className="flex gap-2 pt-2 border-t border-[#E6E1D6]">
                    <input
                      type="text"
                      value={ckCouponInput}
                      onChange={(e) => setCkCouponInput(e.target.value.toUpperCase())}
                      placeholder="Coupon code"
                      className="flex-1 px-3 py-2 text-xs font-mono uppercase border border-[#D6D0C4] rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={handleApplyCoupon}
                      className="px-4 py-2 text-xs font-medium bg-[#141413] text-white rounded-lg"
                    >
                      Apply
                    </button>
                  </div>

                  <div className="space-y-2 pt-3 border-t border-[#E6E1D6] text-sm tabular-nums">
                    <div className="flex justify-between text-[#57534E]">
                      <span>Subtotal</span>
                      <span>{formatPKR(cartSubtotal)}</span>
                    </div>
                    {ckAppliedDiscount && (
                      <div className="flex justify-between text-emerald-700">
                        <span>Discount ({ckAppliedDiscount.code})</span>
                        <span>-{formatPKR(ckAppliedDiscount.amount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-[#57534E]">
                      <span>Courier Shipping</span>
                      <span>{effectiveShipping === 0 ? 'Free' : formatPKR(effectiveShipping)}</span>
                    </div>
                    <div className="flex justify-between font-semibold text-base text-[#141413] pt-2 border-t border-[#E6E1D6]">
                      <span>Total Payable (PKR)</span>
                      <span>{formatPKR(orderTotal)}</span>
                    </div>
                  </div>
                </aside>
              </div>
            )}
          </section>
        )}

        {/* PUBLIC ORDER TRACKING PAGE */}
        {page === 'track' && (
          <section className="max-w-3xl mx-auto px-4 sm:px-8 py-12 space-y-8">
            <div className="text-center space-y-2">
              <h1 className="font-serif text-4xl font-semibold text-[#141413]">
                Track Your Order
              </h1>
              <p className="text-sm text-[#57534E]">
                Enter your order number (e.g. ORD-261118-A1B2) to check fulfillment and courier dispatch progress.
              </p>
            </div>

            <form onSubmit={handleTrackOrder} className="flex gap-3">
              <input
                type="text"
                required
                value={trackInput}
                onChange={(e) => setTrackInput(e.target.value.toUpperCase())}
                placeholder="ORD-XXXXXX-XXXX"
                className="flex-1 px-4 py-3 text-sm font-mono uppercase bg-white border border-[#D6D0C4] rounded-lg"
              />
              <button
                type="submit"
                disabled={trackLoading}
                className="px-6 py-3 text-sm font-medium text-white rounded-lg cursor-pointer"
                style={{ backgroundColor: settings.primaryColor || '#0F3D2E' }}
              >
                {trackLoading ? 'Checking...' : 'Track'}
              </button>
            </form>

            {trackError && (
              <div className="p-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl">
                {trackError}
              </div>
            )}

            {trackedOrder && (
              <div className="bg-white border border-[#E6E1D6] rounded-xl p-6 sm:p-8 space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E6E1D6] pb-4">
                  <div>
                    <p className="text-xs text-[#78716C]">Order Number</p>
                    <p className="font-mono text-lg font-semibold text-[#141413]">
                      {trackedOrder.orderNumber}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-[#78716C]">Current Status</p>
                    <p className="text-sm font-semibold text-[#0F3D2E]">
                      {ORDER_STATUS_LABELS[trackedOrder.status] || trackedOrder.status}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                  <div>
                    <p className="text-[#78716C]">Destination City</p>
                    <p className="font-medium text-[#141413] mt-0.5">{trackedOrder.city || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[#78716C]">Courier Provider</p>
                    <p className="font-medium text-[#141413] mt-0.5">
                      {trackedOrder.courierCompany || 'Pending Dispatch'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[#78716C]">Tracking Number</p>
                    <p className="font-mono font-medium text-[#141413] mt-0.5">
                      {trackedOrder.trackingNumber || '—'}
                    </p>
                  </div>
                </div>

                {trackedOrder.statusHistory && trackedOrder.statusHistory.length > 0 && (
                  <div className="space-y-3 pt-2 border-t border-[#E6E1D6]">
                    <h3 className="text-xs font-semibold text-[#141413]">Status Timeline</h3>
                    <div className="space-y-3">
                      {trackedOrder.statusHistory.map((h, i) => (
                        <div key={i} className="flex items-start justify-between gap-4 text-xs">
                          <div>
                            <p className="font-semibold text-[#141413]">
                              {ORDER_STATUS_LABELS[h.status] || h.status}
                            </p>
                            <p className="text-[#57534E]">{h.note}</p>
                          </div>
                          <span className="text-[#78716C] tabular-nums shrink-0">
                            {formatDateTime(h.timestamp)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* CUSTOMER ACCOUNT / LOGIN / PORTAL ACCESS */}
        {page === 'account' && (
          <section className="max-w-5xl mx-auto px-4 sm:px-8 py-10 space-y-8">
            {authLoading ? (
              <div className="bg-white border border-[#E6E1D6] rounded-xl p-10 text-center text-sm text-[#57534E]">
                Checking authentication session...
              </div>
            ) : !currentUser ? (
              <div className="max-w-lg mx-auto bg-white border border-[#E6E1D6] rounded-xl p-8 space-y-6 text-center">
                <UserIcon className="w-10 h-10 text-[#0F3D2E] mx-auto" />
                <div className="space-y-2">
                  <h1 className="font-serif text-3xl font-semibold text-[#141413]">
                    Customer & Staff Sign In
                  </h1>
                  <p className="text-sm text-[#57534E]">
                    Sign in with your Google account to view your order history, save delivery details, or access your authorized business portal.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onGoogleSignIn}
                  className="w-full py-3 px-5 text-sm font-medium text-white rounded-lg inline-flex items-center justify-center gap-2 cursor-pointer"
                  style={{ backgroundColor: settings.primaryColor || '#0F3D2E' }}
                >
                  <LogIn className="w-4 h-4" /> Continue with Google
                </button>
                <p className="text-xs text-[#78716C]">
                  New customers are registered automatically upon sign-in. Staff and Owner roles are verified securely in Firestore.
                </p>
              </div>
            ) : (
              <div className="space-y-8">
                <div className="bg-white border border-[#E6E1D6] rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <p className="text-xs text-[#78716C]">
                      Signed in · Role: {currentUser.role}
                    </p>
                    <h1 className="font-serif text-3xl font-semibold text-[#141413]">
                      {currentUser.displayName}
                    </h1>
                    <p className="text-sm text-[#57534E]">{currentUser.email}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    {isStaff && (
                      <button
                        type="button"
                        onClick={() => onOpenPortal('admin')}
                        className="px-4 py-2 text-xs font-medium bg-[#0F3D2E] text-white rounded-lg cursor-pointer"
                      >
                        Open Admin / Ops Portal
                      </button>
                    )}
                    {isSalesmanUser && (
                      <button
                        type="button"
                        onClick={() => onOpenPortal('salesman')}
                        className="px-4 py-2 text-xs font-medium bg-[#141413] text-white rounded-lg cursor-pointer"
                      >
                        Open Salesman Portal
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onSignOut}
                      className="px-4 py-2 text-xs font-medium border border-[#D6D0C4] rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" /> Sign Out
                    </button>
                  </div>
                </div>

                {/* Personal Order History */}
                <div className="bg-white border border-[#E6E1D6] rounded-xl overflow-hidden">
                  <div className="px-6 py-4 border-b border-[#E6E1D6]">
                    <h2 className="text-base font-semibold text-[#141413]">
                      My Order History ({myOrders.length})
                    </h2>
                  </div>
                  {myOrders.length === 0 ? (
                    <div className="p-8 text-center text-sm text-[#57534E]">
                      You have not placed any orders under this account yet.
                    </div>
                  ) : (
                    <div className="divide-y divide-[#E6E1D6]">
                      {myOrders.map((ord) => (
                        <div
                          key={ord.id}
                          className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                        >
                          <div>
                            <div className="flex items-center gap-2 text-sm">
                              <span className="font-mono font-semibold text-[#141413]">
                                {ord.orderNumber}
                              </span>
                              <span className="text-[#78716C]">·</span>
                              <span className="text-xs font-medium text-[#0F3D2E]">
                                {ORDER_STATUS_LABELS[ord.status]}
                              </span>
                            </div>
                            <p className="text-xs text-[#57534E] mt-1">
                              {formatDateTime(ord.createdAt)} · {ord.suitsCount} item(s) ·{' '}
                              {ord.paymentMethod === 'COD' ? 'Cash on Delivery' : 'Bank Transfer'}
                            </p>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-sm font-semibold tabular-nums">
                              {formatPKR(ord.totalAmount)}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setTrackInput(ord.orderNumber);
                                navTo('track');
                              }}
                              className="text-xs font-medium underline underline-offset-4 text-[#141413]"
                            >
                              Track
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ABOUT / CONTACT / FAQ / POLICIES */}
        {['about', 'contact', 'faq', 'privacy', 'shipping', 'returns', 'terms'].includes(page) && (
          <section className="max-w-4xl mx-auto px-4 sm:px-8 py-12 space-y-6">
            {page === 'about' && (
              <div className="space-y-6">
                <h1 className="font-serif text-4xl font-semibold text-[#141413]">
                  About {settings.brandName}
                </h1>
                <div className="aspect-[16/9] rounded-xl overflow-hidden border border-[#E6E1D6]">
                  <SafeImage src={FALLBACK_CRAFT} alt="Textile craftsmanship" className="w-full h-full object-cover" />
                </div>
                <p className="text-base text-[#57534E] leading-relaxed">{settings.aboutText}</p>
                <p className="text-sm text-[#57534E] leading-relaxed">
                  Delivery coverage: {settings.deliveryCoverage}. Courier partners:{' '}
                  {settings.courierProviders.join(', ')}.
                </p>
              </div>
            )}

            {page === 'contact' && (
              <div className="bg-white border border-[#E6E1D6] rounded-xl p-8 space-y-5">
                <h1 className="font-serif text-4xl font-semibold text-[#141413]">Contact Us</h1>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm">
                  <div>
                    <p className="text-xs text-[#78716C] uppercase font-medium">Phone & Support</p>
                    <p className="mt-1 font-medium text-[#141413]">{settings.phone || 'Configure in Settings'}</p>
                    <p className="text-[#57534E] mt-1">{settings.contactEmail || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#78716C] uppercase font-medium">Address</p>
                    <p className="mt-1 text-[#141413] flex items-start gap-1.5">
                      <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-[#0F3D2E]" />
                      <span>{settings.address || 'Configure business address in Settings'}</span>
                    </p>
                  </div>
                </div>
                {settings.whatsappNumber && (
                  <a
                    href={whatsappHref(`Assalam-o-Alaikum ${settings.brandName} team, I have a question.`)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-white rounded-lg"
                    style={{ backgroundColor: settings.primaryColor || '#0F3D2E' }}
                  >
                    <MessageCircle className="w-4 h-4" /> Chat on WhatsApp Business
                  </a>
                )}
              </div>
            )}

            {page === 'faq' && (
              <div className="space-y-4">
                <h1 className="font-serif text-4xl font-semibold text-[#141413]">
                  Frequently Asked Questions
                </h1>
                {[
                  {
                    q: 'How long does delivery take across Pakistan?',
                    a: settings.shippingPolicy,
                  },
                  {
                    q: 'Can I pay Cash on Delivery (COD)?',
                    a: 'Yes, Cash on Delivery is available across major cities in Pakistan. You may also pay via verified Bank Transfer, JazzCash, or Easypaisa.',
                  },
                  {
                    q: 'What is your return and exchange policy?',
                    a: settings.returnPolicy,
                  },
                ].map((item, idx) => (
                  <div key={idx} className="bg-white border border-[#E6E1D6] rounded-xl p-6">
                    <h3 className="font-semibold text-[#141413] mb-1.5">{item.q}</h3>
                    <p className="text-sm text-[#57534E]">{item.a}</p>
                  </div>
                ))}
              </div>
            )}

            {page === 'shipping' && (
              <div className="bg-white border border-[#E6E1D6] rounded-xl p-8 space-y-4">
                <h1 className="font-serif text-3xl font-semibold">Shipping Policy</h1>
                <p className="text-sm text-[#57534E] leading-relaxed">{settings.shippingPolicy}</p>
                <p className="text-sm text-[#57534E]">
                  Standard Shipping: {formatPKR(settings.shippingCharges)} · Couriers:{' '}
                  {settings.courierProviders.join(', ')}
                </p>
              </div>
            )}

            {page === 'returns' && (
              <div className="bg-white border border-[#E6E1D6] rounded-xl p-8 space-y-4">
                <h1 className="font-serif text-3xl font-semibold">Return & Exchange Policy</h1>
                <p className="text-sm text-[#57534E] leading-relaxed">{settings.returnPolicy}</p>
              </div>
            )}

            {page === 'privacy' && (
              <div className="bg-white border border-[#E6E1D6] rounded-xl p-8 space-y-4">
                <h1 className="font-serif text-3xl font-semibold">Privacy Policy</h1>
                <p className="text-sm text-[#57534E] leading-relaxed">{settings.privacyPolicy}</p>
              </div>
            )}

            {page === 'terms' && (
              <div className="bg-white border border-[#E6E1D6] rounded-xl p-8 space-y-4">
                <h1 className="font-serif text-3xl font-semibold">Terms & Conditions</h1>
                <p className="text-sm text-[#57534E] leading-relaxed">{settings.termsPolicy}</p>
              </div>
            )}
          </section>
        )}
      </main>

      {/* Slide-over Shopping Bag Drawer */}
      {bagOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex justify-end">
          <div className="w-full max-w-md bg-white h-full flex flex-col border-l border-[#E6E1D6]">
            <div className="px-6 py-4 border-b border-[#E6E1D6] flex items-center justify-between">
              <h2 className="font-serif text-2xl font-semibold text-[#141413]">
                Shopping Bag ({cartCount})
              </h2>
              <button
                type="button"
                onClick={() => setBagOpen(false)}
                className="p-2 text-[#57534E] hover:text-[#141413]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {cart.length === 0 ? (
                <div className="text-center py-16 space-y-3">
                  <ShoppingBag className="w-8 h-8 text-[#9A7B3E] mx-auto opacity-70" />
                  <p className="text-sm text-[#57534E]">Your shopping bag is currently empty.</p>
                </div>
              ) : (
                cart.map((item) => {
                  const base = item.variant.sellingPrice || item.product.sellingPrice;
                  const unit = Math.round(base * (1 - (item.product.discountPercent || 0) / 100));
                  return (
                    <div
                      key={item.variant.id}
                      className="flex gap-4 pb-4 border-b border-[#E6E1D6]"
                    >
                      <div className="w-20 h-20 rounded-lg overflow-hidden bg-[#EFECE4] shrink-0">
                        <SafeImage
                          src={item.product.images[0] || FALLBACK_PRODUCT}
                          alt={item.product.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#141413] truncate">
                          {item.product.name}
                        </p>
                        <p className="text-xs text-[#78716C] mt-0.5">
                          {item.variant.size} · {item.variant.color}
                        </p>
                        <div className="flex items-center justify-between mt-3">
                          <div className="inline-flex items-center border border-[#D6D0C4] rounded-md">
                            <button
                              type="button"
                              onClick={() => updateCartQty(item.variant.id, -1)}
                              className="p-1.5 text-[#57534E]"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="px-2.5 text-xs font-medium tabular-nums">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateCartQty(item.variant.id, 1)}
                              className="p-1.5 text-[#57534E]"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                          <span className="text-sm font-semibold tabular-nums">
                            {formatPKR(unit * item.quantity)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {cart.length > 0 && (
              <div className="p-6 border-t border-[#E6E1D6] bg-[#FAF9F6] space-y-4">
                <div className="flex justify-between text-sm font-semibold tabular-nums">
                  <span>Subtotal</span>
                  <span>{formatPKR(cartSubtotal)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setBagOpen(false);
                    navTo('checkout');
                  }}
                  className="w-full py-3 text-sm font-medium text-white rounded-lg cursor-pointer"
                  style={{ backgroundColor: settings.primaryColor || '#0F3D2E' }}
                >
                  Proceed to Checkout
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Clean Footer */}
      <footer className="bg-[#F2EFE9] border-t border-[#E6E1D6] mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 text-sm">
          <div className="space-y-3">
            <p className="font-serif text-2xl font-semibold text-[#141413]">
              {settings.brandName}
            </p>
            <p className="text-xs text-[#57534E] leading-relaxed">{settings.tagline}</p>
            <p className="text-xs text-[#78716C]">{settings.address}</p>
          </div>

          <div className="space-y-2 text-xs">
            <p className="font-semibold text-[#141413] uppercase tracking-wider mb-2">Shop</p>
            <button type="button" onClick={() => navTo('shop')} className="block text-[#57534E] hover:text-[#141413]">
              All Apparel
            </button>
            <button type="button" onClick={() => navTo('track')} className="block text-[#57534E] hover:text-[#141413]">
              Track Order
            </button>
            <button type="button" onClick={() => navTo('faq')} className="block text-[#57534E] hover:text-[#141413]">
              FAQ
            </button>
            <button type="button" onClick={() => navTo('contact')} className="block text-[#57534E] hover:text-[#141413]">
              Contact & WhatsApp
            </button>
          </div>

          <div className="space-y-2 text-xs">
            <p className="font-semibold text-[#141413] uppercase tracking-wider mb-2">Policies</p>
            <button type="button" onClick={() => navTo('shipping')} className="block text-[#57534E] hover:text-[#141413]">
              Shipping Policy
            </button>
            <button type="button" onClick={() => navTo('returns')} className="block text-[#57534E] hover:text-[#141413]">
              Return & Exchange
            </button>
            <button type="button" onClick={() => navTo('privacy')} className="block text-[#57534E] hover:text-[#141413]">
              Privacy Policy
            </button>
            <button type="button" onClick={() => navTo('terms')} className="block text-[#57534E] hover:text-[#141413]">
              Terms & Conditions
            </button>
          </div>

          <div className="space-y-2 text-xs">
            <p className="font-semibold text-[#141413] uppercase tracking-wider mb-2">
              Team & Operations
            </p>
            {isStaff ? (
              <button
                type="button"
                onClick={() => onOpenPortal('admin')}
                className="inline-flex items-center gap-1.5 text-[#0F3D2E] font-semibold hover:underline"
              >
                <ShieldCheck className="w-3.5 h-3.5" /> Owner / Admin Dashboard
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navTo('account')}
                className="block text-[#57534E] hover:text-[#141413]"
              >
                Staff Portal Login
              </button>
            )}
            {isSalesmanUser && (
              <button
                type="button"
                onClick={() => onOpenPortal('salesman')}
                className="block text-[#0F3D2E] font-semibold hover:underline"
              >
                Salesman Portal
              </button>
            )}
            <div className="pt-2 flex items-center gap-2 text-[#78716C]">
              <Truck className="w-3.5 h-3.5" />
              <span>PKR · Cash on Delivery</span>
            </div>
          </div>
        </div>
        <div className="border-t border-[#E6E1D6] py-4 px-4 sm:px-8 max-w-7xl mx-auto flex flex-wrap items-center justify-between text-xs text-[#78716C]">
          <span>© {new Date().getFullYear()} {settings.brandName}. All rights reserved.</span>
          <span>Currency: PKR</span>
        </div>
      </footer>
    </div>
  );
};
