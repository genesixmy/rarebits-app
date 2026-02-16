import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ProfileSettings from '@/components/ProfileSettings';
import CategorySettings from '@/components/CategorySettings';
import InvoiceSettings from '@/components/InvoiceSettings';
import SalesChannelSettings from '@/components/SalesChannelSettings';
import { User, Tag, FileText, Store } from 'lucide-react';
import { ProfileFormProvider } from '@/contexts/ProfileFormContext';

const SettingsPage = ({ user, categories, onUpdateCategories, onUpdateProfile }) => {
  return (
    <div className="space-y-6">
      <h1 className="page-title">Tetapan</h1>
      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="!grid w-full !h-auto grid-cols-2 sm:grid-cols-4 gap-1">
          <TabsTrigger value="profile" className="w-full min-h-10 gap-2 text-xs sm:text-sm">
            <User className="w-4 h-4" /> Profil
          </TabsTrigger>
          <TabsTrigger value="categories" className="w-full min-h-10 gap-2 text-xs sm:text-sm">
            <Tag className="w-4 h-4" /> Kategori
          </TabsTrigger>
          <TabsTrigger value="sales-channel" className="w-full min-h-10 gap-2 text-xs sm:text-sm">
            <Store className="w-4 h-4" /> Platform
          </TabsTrigger>
          <TabsTrigger value="invoice" className="w-full min-h-10 gap-2 text-xs sm:text-sm">
            <FileText className="w-4 h-4" /> Brand
          </TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="mt-6">
          <ProfileFormProvider userId={user.id}>
            <ProfileSettings user={user} onUpdateProfile={onUpdateProfile} />
          </ProfileFormProvider>
        </TabsContent>
        <TabsContent value="categories" className="mt-6">
          <CategorySettings
            categories={categories}
            onUpdate={onUpdateCategories}
            userId={user.id}
          />
        </TabsContent>
        <TabsContent value="sales-channel" className="mt-6">
          <SalesChannelSettings userId={user.id} />
        </TabsContent>
        <TabsContent value="invoice" className="mt-6">
          <InvoiceSettings userId={user.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SettingsPage;
