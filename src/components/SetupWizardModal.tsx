import React, { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { Check, ChevronLeft, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import { db, makeSafeId } from '../lib/firebase';
import { slugify } from '../lib/format';
import { saveBusinessSettings } from '../services/businessService';
import { AudienceType, BusinessSettings, Category, PaymentMethod, UserProfile } from '../types';

interface SetupWizardModalProps {
  initialSettings: BusinessSettings;
  existingCategories: Category[];
  actor: UserProfile;
  onClose: () => void;
  onSaved: (updated: BusinessSettings) => void;
}

const STEPS = [
  'Brand Identity',
  'Catalog & Categories',
  'Contact & Coverage',
  'Shipping, Returns & Payments',
];

export const SetupWizardModal: React.FC<SetupWizardModalProps> = ({
  initialSettings,
  existingCategories,
  actor,
  onClose,
  onSaved,
}) => {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<BusinessSettings>({ ...initialSettings });
  const [newCategories, setNewCategories] = useState<
    { name: string; audience: AudienceType; description: string }[]
  >(
    existingCategories.length > 0
      ? []
      : [
          { name: 'Embroidered Lawn', audience: 'Ladies', description: '3-piece cotton lawn suits' },
          { name: 'Gents Shalwar Kameez', audience: 'Gents', description: 'Tailored cotton suits' },
        ]
  );
  const [catName, setCatName] = useState('');
  const [catAudience, setCatAudience] = useState<AudienceType>('Both');
  const [courierInput, setCourierInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleAddCategory = () => {
    const trimmed = catName.trim();
    if (!trimmed) return;
    setNewCategories((prev) => [
      ...prev,
      { name: trimmed, audience: catAudience, description: '' },
    ]);
    setCatName('');
  };

  const handleTogglePayment = (method: PaymentMethod) => {
    setForm((prev) => {
      const exists = prev.paymentMethods.includes(method);
      const next = exists
        ? prev.paymentMethods.filter((m) => m !== method)
        : [...prev.paymentMethods, method];
      return { ...prev, paymentMethods: next.length > 0 ? next : ['COD'] };
    });
  };

  const handleAddCourier = () => {
    const trimmed = courierInput.trim();
    if (!trimmed) return;
    if (!form.courierProviders.includes(trimmed)) {
      setForm((prev) => ({ ...prev, courierProviders: [...prev.courierProviders, trimmed] }));
    }
    setCourierInput('');
  };

  const handleFinish = async () => {
    if (!form.brandName.trim()) {
      setErrorMsg('Brand name is required.');
      setStep(0);
      return;
    }
    setSaving(true);
    setErrorMsg('');
    try {
      const updated: BusinessSettings = {
        ...form,
        currency: 'PKR',
        setupCompleted: true,
        updatedAt: new Date().toISOString(),
      };
      await saveBusinessSettings(updated, actor);

      const now = new Date().toISOString();
      for (let i = 0; i < newCategories.length; i++) {
        const c = newCategories[i];
        const id = makeSafeId(`cat_${slugify(c.name)}`);
        await setDoc(doc(db, 'categories', id), {
          name: c.name.slice(0, 80),
          slug: slugify(c.name),
          audience: c.audience,
          description: c.description.slice(0, 300),
          active: true,
          sortOrder: existingCategories.length + i + 1,
          createdAt: now,
        });
      }

      onSaved(updated);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save configuration.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full shadow-xl overflow-hidden my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Business Setup Wizard
            </h2>
            <p className="text-xs text-slate-500">
              Step {step + 1} of {STEPS.length} · {STEPS[step]}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 rounded-lg"
            aria-label="Close setup wizard"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step Progress Bar */}
        <div className="grid grid-cols-4 border-b border-slate-200 bg-slate-50">
          {STEPS.map((label, idx) => (
            <button
              key={label}
              type="button"
              onClick={() => setStep(idx)}
              className={`px-3 py-2.5 text-xs font-medium text-left transition-colors border-b-2 ${
                idx === step
                  ? 'border-slate-900 text-slate-900 bg-white'
                  : idx < step
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-slate-500'
              }`}
            >
              <span className="truncate block">{idx + 1}. {label}</span>
            </button>
          ))}
        </div>

        <div className="p-6 space-y-5 max-h-[65vh] overflow-y-auto">
          {errorMsg && (
            <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {errorMsg}
            </div>
          )}

          {step === 0 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Brand Name
                  </label>
                  <input
                    type="text"
                    value={form.brandName}
                    onChange={(e) => setForm({ ...form, brandName: e.target.value })}
                    placeholder="e.g. Zayr & Loom"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Currency
                  </label>
                  <input
                    type="text"
                    value="PKR (Pakistani Rupee)"
                    disabled
                    className="w-full px-3 py-2 text-sm border border-slate-200 bg-slate-50 text-slate-500 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Brand Tagline
                </label>
                <input
                  type="text"
                  value={form.tagline}
                  onChange={(e) => setForm({ ...form, tagline: e.target.value })}
                  placeholder="e.g. Fine Pakistani Cotton Lawn & Tailored Shalwar Kameez"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Brand Logo URL (optional)
                </label>
                <input
                  type="url"
                  value={form.logoUrl}
                  onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                  placeholder="https://... (leave blank to use typography wordmark)"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Primary Brand Color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={form.primaryColor}
                      onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                      className="w-10 h-9 border border-slate-300 rounded cursor-pointer"
                    />
                    <input
                      type="text"
                      value={form.primaryColor}
                      onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                      className="flex-1 px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Accent Color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={form.accentColor}
                      onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
                      className="w-10 h-9 border border-slate-300 rounded cursor-pointer"
                    />
                    <input
                      type="text"
                      value={form.accentColor}
                      onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
                      className="flex-1 px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-2">
                  Clothing Focus (Ladies / Gents / Both)
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {(['Ladies', 'Gents', 'Both'] as AudienceType[]).map((aud) => (
                    <button
                      key={aud}
                      type="button"
                      onClick={() => setForm({ ...form, audienceType: aud })}
                      className={`py-2.5 px-4 text-sm font-medium rounded-lg border transition-colors ${
                        form.audienceType === aud
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {aud}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200">
                <label className="block text-xs font-medium text-slate-700 mb-2">
                  Initial Product Categories
                </label>
                {existingCategories.length > 0 && (
                  <p className="text-xs text-slate-500 mb-2">
                    Existing active categories: {existingCategories.map((c) => c.name).join(' · ')}
                  </p>
                )}
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={catName}
                    onChange={(e) => setCatName(e.target.value)}
                    placeholder="Category name (e.g. Festive Velvet)"
                    className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                  <select
                    value={catAudience}
                    onChange={(e) => setCatAudience(e.target.value as AudienceType)}
                    className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Ladies">Ladies</option>
                    <option value="Gents">Gents</option>
                    <option value="Both">Both</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleAddCategory}
                    className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>

                {newCategories.length > 0 && (
                  <div className="mt-3 divide-y divide-slate-100 border border-slate-200 rounded-lg">
                    {newCategories.map((cat, idx) => (
                      <div key={idx} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span>
                          <span className="font-medium text-slate-900">{cat.name}</span>
                          <span className="text-slate-400 mx-2">·</span>
                          <span className="text-xs text-slate-500">{cat.audience}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setNewCategories((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="text-slate-400 hover:text-red-600 p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Business Contact Email
                  </label>
                  <input
                    type="email"
                    value={form.contactEmail}
                    onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                    placeholder="orders@yourbrand.pk"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Support Phone Number
                  </label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="+92 300 1234567"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  WhatsApp Business Number (digits with country code, e.g. 923001234567)
                </label>
                <input
                  type="text"
                  value={form.whatsappNumber}
                  onChange={(e) => setForm({ ...form, whatsappNumber: e.target.value })}
                  placeholder="923001234567"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Business / Warehouse Address
                </label>
                <textarea
                  rows={2}
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="Warehouse or studio address in Pakistan"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Delivery Coverage
                </label>
                <input
                  type="text"
                  value={form.deliveryCoverage}
                  onChange={(e) => setForm({ ...form, deliveryCoverage: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Flat Shipping Charge (PKR)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={form.shippingCharges}
                    onChange={(e) =>
                      setForm({ ...form, shippingCharges: Math.max(0, Number(e.target.value)) })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Free Shipping Threshold (PKR, 0 to disable)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={form.freeShippingThreshold}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        freeShippingThreshold: Math.max(0, Number(e.target.value)),
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Courier Providers
                </label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={courierInput}
                    onChange={(e) => setCourierInput(e.target.value)}
                    placeholder="Add courier (e.g. Daewoo FastEx)"
                    className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={handleAddCourier}
                    className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg"
                  >
                    Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {form.courierProviders.map((cp) => (
                    <span
                      key={cp}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-slate-100 border border-slate-200 rounded-md text-slate-700"
                    >
                      {cp}
                      <button
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            courierProviders: form.courierProviders.filter((x) => x !== cp),
                          })
                        }
                        className="text-slate-400 hover:text-red-600"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Enabled Payment Methods
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => handleTogglePayment('COD')}
                    className={`py-2 px-3 text-xs font-medium rounded-lg border text-left ${
                      form.paymentMethods.includes('COD')
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-300 text-slate-700'
                    }`}
                  >
                    Cash on Delivery (COD)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTogglePayment('BANK_TRANSFER')}
                    className={`py-2 px-3 text-xs font-medium rounded-lg border text-left ${
                      form.paymentMethods.includes('BANK_TRANSFER')
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-300 text-slate-700'
                    }`}
                  >
                    Manual Bank / Mobile Transfer
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Bank / JazzCash / Easypaisa Transfer Instructions
                </label>
                <textarea
                  rows={2}
                  value={form.bankDetails}
                  onChange={(e) => setForm({ ...form, bankDetails: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Return & Exchange Policy
                </label>
                <textarea
                  rows={2}
                  value={form.returnPolicy}
                  onChange={(e) => setForm({ ...form, returnPolicy: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50">
          <button
            type="button"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="px-4 py-2 text-xs font-medium border border-slate-300 rounded-lg text-slate-700 disabled:opacity-40 inline-flex items-center gap-1"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Back
          </button>

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 inline-flex items-center gap-1"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={handleFinish}
              className="px-5 py-2 text-xs font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              {saving ? 'Saving Configuration...' : 'Save & Launch Storefront'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
