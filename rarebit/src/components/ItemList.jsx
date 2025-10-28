import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Trash2, Tag, Wallet } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

const ItemCard = ({ item, onEdit, onDelete, index }) => {
  const { toast } = useToast();

  const handleDelete = (e) => {
    e.stopPropagation();
    if (window.confirm(`Anda pasti mahu padam "${item.name}"? Tindakan ini tidak boleh diundur.`)) {
      onDelete(item.id);
      toast({
        title: "Item Dipadam",
        description: `${item.name} telah dikeluarkan daripada inventori.`
      });
    }
  };

  const profit = item.status === 'terjual' && item.selling_price ? (parseFloat(item.selling_price) - parseFloat(item.cost_price)) : 0;
  const isLoss = profit < 0;

  const statusClasses = {
    tersedia: 'status-available',
    terjual: 'status-sold',
    reserved: 'status-reserved'
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ delay: index * 0.05 }}
      onClick={() => onEdit(item)}
      className="cursor-pointer group"
    >
      <Card className="overflow-hidden h-full flex flex-col group-hover:border-primary/50 transition-all duration-300 group-hover:shadow-lg dark:group-hover:shadow-primary/10">
        {item.image_url ? (
          <div className="h-48 w-full overflow-hidden">
            <img 
              src={item.image_url} 
              alt={item.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          </div>
        ) : (
          <div className="h-48 w-full bg-secondary flex items-center justify-center">
            <Tag className="w-16 h-16 text-muted-foreground/20" />
          </div>
        )}
        
        <CardContent className="p-4 flex-1 flex flex-col">
          <div className="flex items-start justify-between mb-2">
            <h3 className="font-semibold text-md text-foreground line-clamp-2 flex-1">
              {item.name}
            </h3>
            <span className={cn('status-badge ml-2', statusClasses[item.status] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200')}>
              {item.status}
            </span>
          </div>

          <div className="space-y-2 text-sm text-muted-foreground flex-1">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4" />
              <span className={cn('status-badge', `category-${(item.category || '').toLowerCase().replace(/\s+/g, '-')}`)}>
                {item.category}
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-primary" />
              <span>
                Kos: <span className="font-medium text-foreground">RM {parseFloat(item.cost_price).toFixed(2)}</span>
                {item.selling_price && (
                  <span className="ml-2">
                    | Jual: <span className={cn("font-medium", isLoss ? "text-red-500 dark:text-red-400" : "text-green-600 dark:text-green-400")}>RM {parseFloat(item.selling_price).toFixed(2)}</span>
                  </span>
                )}
              </span>
            </div>

            {item.status === 'terjual' && item.selling_price && (
              <div className="text-sm">
                {isLoss ? 'Rugi' : 'Untung'}: <span className={cn("font-medium", isLoss ? "text-red-500 dark:text-red-400" : "text-green-600 dark:text-green-400")}>
                  RM {Math.abs(profit).toFixed(2)}
                </span>
              </div>
            )}
          </div>

          <div className="flex justify-end mt-4 pt-4 border-t border-border">
            <Button variant="destructive" size="icon" onClick={handleDelete}><Trash2 className="w-4 h-4" /></Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

const ItemList = ({ items, onEdit, onDelete }) => {
  if (items.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-center py-16"
      >
        <Card className="p-8 max-w-md mx-auto">
          <div className="w-16 h-16 mx-auto mb-4 bg-primary/10 rounded-full flex items-center justify-center">
            <Tag className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-xl font-semibold text-foreground mb-2">Tiada Item Dijumpai</h3>
          <p className="text-muted-foreground">Mulakan dengan menambah item pertama anda ke dalam inventori!</p>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      <AnimatePresence>
        {items.map((item, index) => (
          <ItemCard key={item.id} item={item} onEdit={onEdit} onDelete={onDelete} index={index} />
        ))}
      </AnimatePresence>
    </motion.div>
  );
};

export default ItemList;