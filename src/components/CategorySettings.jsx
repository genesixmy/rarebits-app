import React, { useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Plus, Trash2, Edit, Save, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const PREDEFINED_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', 
  '#22c55e', '#14b8a6', '#0ea5e9', '#6366f1'
];

const CategorySettings = ({ categories, onUpdate, userId }) => {
  const { toast } = useToast();
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState(PREDEFINED_COLORS[0]);
  const [editingCategory, setEditingCategory] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleAddCategory = async (e) => {
    e.preventDefault();
    if (!newCategoryName.trim()) {
      toast({ variant: "destructive", title: "Nama kategori diperlukan" });
      return;
    }
    setLoading(true);
    const { error } = await supabase
      .from('categories')
      .insert({ name: newCategoryName, color: newCategoryColor, user_id: userId });

    if (error) {
      toast({ variant: "destructive", title: "Gagal menambah kategori", description: error.message });
    } else {
      toast({ title: "Kategori berjaya ditambah!" });
      setNewCategoryName('');
      onUpdate();
    }
    setLoading(false);
  };
  
  const handleUpdateCategory = async (e) => {
    e.preventDefault();
    if (!editingCategory.name.trim()) {
      toast({ variant: "destructive", title: "Nama kategori diperlukan" });
      return;
    }
    setLoading(true);
    const { error } = await supabase
      .from('categories')
      .update({ name: editingCategory.name, color: editingCategory.color })
      .eq('id', editingCategory.id);
      
    if (error) {
      toast({ variant: "destructive", title: "Gagal kemaskini kategori", description: error.message });
    } else {
      toast({ title: "Kategori berjaya dikemaskini!" });
      setEditingCategory(null);
      onUpdate();
    }
    setLoading(false);
  };
  
  const handleDeleteCategory = async (categoryId) => {
      if (!window.confirm("Anda pasti mahu memadam kategori ini?")) return;
      setLoading(true);
      const { error } = await supabase.from('categories').delete().eq('id', categoryId);
      if (error) {
        toast({ variant: "destructive", title: "Gagal memadam kategori", description: error.message });
      } else {
        toast({ title: "Kategori berjaya dipadam!" });
        onUpdate();
      }
      setLoading(false);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Tambah Kategori Baru</CardTitle>
          <CardDescription>Cipta kategori untuk menyusun item anda.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddCategory} className="space-y-4">
            <div>
              <label htmlFor="new-category-name" className="block text-sm font-medium text-muted-foreground mb-1">Nama Kategori</label>
              <Input id="new-category-name" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="cth: Mainan Vintage" />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Warna</label>
              <div className="flex flex-wrap gap-2">
                {PREDEFINED_COLORS.map(color => (
                  <button key={color} type="button" onClick={() => setNewCategoryColor(color)} className={cn("w-8 h-8 rounded-full border-2 transition", newCategoryColor === color ? "border-primary scale-110" : "border-transparent")} style={{ backgroundColor: color }} />
                ))}
              </div>
            </div>
            <Button type="submit" disabled={loading} className="berry-gradient berry-gradient-hover text-white">
              {loading && !editingCategory ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Tambah
            </Button>
          </form>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>Urus Kategori</CardTitle>
          <CardDescription>Sunting atau padam kategori sedia ada.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {categories.map(cat => (
              <div key={cat.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-2 rounded-lg hover:bg-secondary">
                {editingCategory?.id === cat.id ? (
                  <form onSubmit={handleUpdateCategory} className="flex-1 flex flex-wrap items-center gap-2 w-full">
                    <div style={{ backgroundColor: editingCategory.color }} className="w-5 h-5 rounded-full flex-shrink-0" />
                    <Input value={editingCategory.name} onChange={(e) => setEditingCategory({...editingCategory, name: e.target.value})} className="h-8 flex-1 min-w-[100px]" />
                     <div className="flex gap-1 flex-wrap">
                        {PREDEFINED_COLORS.map(color => (
                          <button key={color} type="button" onClick={() => setEditingCategory({...editingCategory, color})} className={cn("w-6 h-6 rounded-full border-2 transition", editingCategory.color === color ? "border-primary" : "border-transparent")} style={{ backgroundColor: color }} />
                        ))}
                      </div>
                    <div className="flex">
                      <Button type="submit" size="icon" variant="ghost" disabled={loading} className="text-green-600"><Save className="w-4 h-4" /></Button>
                      <Button type="button" size="icon" variant="ghost" onClick={() => setEditingCategory(null)}><X className="w-4 h-4" /></Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div style={{ backgroundColor: cat.color }} className="w-5 h-5 rounded-full flex-shrink-0" />
                      <span className="break-words">{cat.name}</span>
                    </div>
                    <div className="flex items-center flex-shrink-0">
                      <Button size="icon" variant="ghost" onClick={() => setEditingCategory({...cat})}><Edit className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" className="text-red-500" onClick={() => handleDeleteCategory(cat.id)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default CategorySettings;