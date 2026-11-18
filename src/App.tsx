import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { AdminPortal } from './components/AdminPortal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SalesmanPortal } from './components/SalesmanPortal';
import { SetupWizardModal } from './components/SetupWizardModal';
import { Storefront } from './components/Storefront';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
  testConnection,
} from './lib/firebase';
import {
  DEFAULT_BUSINESS_SETTINGS,
  syncUserProfile,
} from './services/businessService';
import {
  BusinessSettings,
  Category,
  Product,
  ProductVariant,
  UserProfile,
} from './types';

type ActiveView = 'store' | 'admin' | 'salesman';

export default function App() {
  const [view, setView] = useState<ActiveView>('store');
  const [authLoading, setAuthLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [connectionWarning, setConnectionWarning] = useState('');

  const [settings, setSettings] = useState<BusinessSettings>(DEFAULT_BUSINESS_SETTINGS);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);

  // 1. Validate Firestore Connection on Boot
  useEffect(() => {
    testConnection().then((res) => {
      if (!res.ok && res.message) {
        setConnectionWarning(res.message);
      }
    });
  }, []);

  // 2. Firebase Auth State Listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setCurrentUser(null);
        setAuthLoading(false);
        setView('store');
        return;
      }
      try {
        const profile = await syncUserProfile(fbUser);
        setCurrentUser(profile);
      } catch (err) {
        console.error('Failed to sync user profile:', err);
      } finally {
        setAuthLoading(false);
      }
    });
    return () => unsub();
  }, []);

  // 3. Public Settings Listener
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'settings', 'business'),
      (snap) => {
        if (snap.exists()) {
          setSettings({
            ...DEFAULT_BUSINESS_SETTINGS,
            ...(snap.data() as Partial<BusinessSettings>),
          });
        }
      },
      (err) => {
        console.warn('Settings listener fallback:', err);
      }
    );
    return () => unsub();
  }, []);

  // 4. Role-Aware Catalog Listeners (only query active==true for non-inventory users so rules pass cleanly)
  const isInventoryStaff = Boolean(
    currentUser &&
      ['OWNER', 'ADMIN', 'INVENTORY_MANAGER'].includes(currentUser.role)
  );

  useEffect(() => {
    const catQ = isInventoryStaff
      ? collection(db, 'categories')
      : query(collection(db, 'categories'), where('active', '==', true));

    const prodQ = isInventoryStaff
      ? collection(db, 'products')
      : query(collection(db, 'products'), where('active', '==', true));

    const varQ = isInventoryStaff
      ? collection(db, 'product_variants')
      : query(collection(db, 'product_variants'), where('active', '==', true));

    const safeListenerError = (path: string) => (err: unknown) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (structuredErr) {
        const msg = structuredErr instanceof Error ? structuredErr.message : String(structuredErr);
        console.warn(`Firestore listener notice (${path}):`, msg);
      }
    };

    const u1 = onSnapshot(
      catQ,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Category, 'id'>) }))
          .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        setCategories(list);
      },
      safeListenerError('categories')
    );

    const u2 = onSnapshot(
      prodQ,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Product, 'id'>) }))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setProducts(list);
      },
      safeListenerError('products')
    );

    const u3 = onSnapshot(
      varQ,
      (snap) => {
        setVariants(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ProductVariant, 'id'>) }))
        );
      },
      safeListenerError('product_variants')
    );

    return () => {
      u1();
      u2();
      u3();
    };
  }, [isInventoryStaff]);

  const handleGoogleSignIn = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const handleSignOut = async () => {
    await signOut(auth);
    setView('store');
  };

  const handleOpenPortal = (portal: 'admin' | 'salesman') => {
    if (!currentUser) return;
    if (
      portal === 'admin' &&
      ['OWNER', 'ADMIN', 'SALES_MANAGER', 'INVENTORY_MANAGER', 'PACKING_STAFF'].includes(
        currentUser.role
      )
    ) {
      setView('admin');
    } else if (
      portal === 'salesman' &&
      ['SALESMAN', 'OWNER', 'ADMIN'].includes(currentUser.role)
    ) {
      setView('salesman');
    }
  };

  return (
    <ErrorBoundary>
      {connectionWarning && (
        <div className="bg-red-700 text-white text-xs text-center py-2 px-4">
          {connectionWarning}
        </div>
      )}

      {view === 'admin' &&
      currentUser &&
      ['OWNER', 'ADMIN', 'SALES_MANAGER', 'INVENTORY_MANAGER', 'PACKING_STAFF'].includes(
        currentUser.role
      ) ? (
        <AdminPortal
          currentUser={currentUser}
          settings={settings}
          categories={categories}
          products={products}
          variants={variants}
          onBackToStore={() => setView('store')}
          onOpenWizard={() => setWizardOpen(true)}
          onSignOut={handleSignOut}
        />
      ) : view === 'salesman' &&
        currentUser &&
        ['SALESMAN', 'OWNER', 'ADMIN'].includes(currentUser.role) ? (
        <SalesmanPortal
          currentUser={currentUser}
          settings={settings}
          products={products}
          variants={variants}
          onBackToStore={() => setView('store')}
          onSignOut={handleSignOut}
        />
      ) : (
        <Storefront
          settings={settings}
          categories={categories}
          products={products}
          variants={variants}
          currentUser={currentUser}
          authLoading={authLoading}
          onGoogleSignIn={handleGoogleSignIn}
          onSignOut={handleSignOut}
          onOpenPortal={handleOpenPortal}
          onOpenWizard={() => setWizardOpen(true)}
        />
      )}

      {wizardOpen &&
        currentUser &&
        ['OWNER', 'ADMIN'].includes(currentUser.role) && (
          <SetupWizardModal
            initialSettings={settings}
            existingCategories={categories}
            actor={currentUser}
            onClose={() => setWizardOpen(false)}
            onSaved={(updated) => setSettings(updated)}
          />
        )}
    </ErrorBoundary>
  );
}
