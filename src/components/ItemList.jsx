import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Trash2, Tag, Wallet, FileText, X, Star, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { cn, formatCurrency } from '@/lib/utils';

const ItemCard = ({
  item,
  onEdit,
  onDelete,
  onToggleFavorite,
  isFavoriteUpdating = false,
  index,
  isSelected,
  onSelectChange,
  categories = [],
  clients = []
}) => {
  const navigate = useNavigate();
  const { toast } = useToast();

  // Find category color
  const categoryColor = categories.find(cat => cat.name === item.category)?.color || '#e5e7eb';

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
  const rawTotalQuantity = parseInt(item.quantity, 10);
  const totalQuantity = Number.isNaN(rawTotalQuantity) ? 1 : rawTotalQuantity;
  const rawReservedQuantity = parseInt(item.quantity_reserved, 10);
  const legacyReservedQuantity = Number.isNaN(rawReservedQuantity) ? 0 : rawReservedQuantity;
  const legacyReservation = (legacyReservedQuantity > 0 || item.reserved_customer_id || item.reserved_customer_name || item.reserved_note)
    ? [{
        quantity_reserved: legacyReservedQuantity || 0,
        customer_id: item.reserved_customer_id || '',
        customer_name: item.reserved_customer_name || '',
        note: item.reserved_note || '',
      }]
    : [];
  const effectiveReservations = Array.isArray(item.inventory_reservations) && item.inventory_reservations.length > 0
    ? item.inventory_reservations
    : legacyReservation;
  const normalizedReservations = effectiveReservations.map((reservation, index) => {
    const quantity = parseInt(reservation.quantity_reserved, 10) || 0;
    const customerId = reservation.customer_id || '';
    const customerName = reservation.customer_name || clients.find(client => client.id === customerId)?.name || '';
    const fallbackName = 'Tanpa pelanggan';
    return {
      quantity,
      customerName: customerName || fallbackName,
    };
  });
  const reservedQuantity = normalizedReservations.reduce((sum, reservation) => sum + reservation.quantity, 0);
  const buyerCount = normalizedReservations.filter(reservation => reservation.quantity > 0).length;
  const availableQuantity = Math.max(totalQuantity - reservedQuantity, 0);
  const isReservedItem = item.status === 'reserved' || reservedQuantity > 0;
  const singleBuyerName = buyerCount === 1 ? normalizedReservations.find(reservation => reservation.quantity > 0)?.customerName : '';
  const reservationSummary = reservedQuantity > 0
    ? `Reserved: ${reservedQuantity} unit${buyerCount > 0 ? `, ${buyerCount} pembeli` : ''}`
    : '';
  const reservationTooltip = normalizedReservations
    .filter(reservation => reservation.quantity > 0)
    .map(reservation => `${reservation.customerName}: ${reservation.quantity} unit`)
    .join('\n');
  const sortedMedia = Array.isArray(item.item_media)
    ? [...item.item_media].sort((a, b) => {
        const aPosition = Number.isInteger(a.position) ? a.position : 0;
        const bPosition = Number.isInteger(b.position) ? b.position : 0;
        return aPosition - bPosition;
      })
    : [];
  const coverImageUrl = item.image_url || sortedMedia.find((media) => media.is_cover)?.url || sortedMedia[0]?.url || '';
  const isFavorite = Boolean(item.is_favorite);
  
  // Format prices - ensure no extra decimals or hidden characters
  const costPriceDisplay = formatCurrency(item.cost_price);
  const sellingPriceDisplay = item.selling_price ? formatCurrency(item.selling_price) : null;
  const profitDisplay = formatCurrency(Math.abs(profit));

  const statusClasses = {
    tersedia: 'status-available',
    terjual: 'status-sold',
    reserved: 'status-reserved'
  };

  const handleCheckboxClick = (e) => {
    e.stopPropagation();
    onSelectChange(item.id);
  };

  const handleToggleFavorite = (e) => {
    e.stopPropagation();
    if (!onToggleFavorite || isFavoriteUpdating) return;
    onToggleFavorite(item);
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
      <Card className={cn(
        "overflow-hidden h-full flex flex-col transition-all duration-300 dark:group-hover:shadow-primary/10 relative",
        isSelected
          ? "border-primary border-2 bg-primary/5 shadow-lg"
          : "group-hover:border-primary/50 group-hover:shadow-lg"
      )}>
        {/* Selection Checkbox */}
        <div className="absolute top-2 left-2 z-10 bg-white dark:bg-slate-950 rounded-md p-1">
          <Checkbox
            checked={isSelected}
            onClick={handleCheckboxClick}
            className="cursor-pointer"
          />
        </div>
        {coverImageUrl ? (
          <div className="h-48 w-full overflow-hidden">
            <img 
              src={coverImageUrl} 
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
            <div className="ml-2 flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleToggleFavorite}
                title={isFavorite ? 'Buang dari kegemaran' : 'Tandakan sebagai kegemaran'}
                disabled={isFavoriteUpdating}
              >
                {isFavoriteUpdating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Star className={cn('h-4 w-4', isFavorite ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground')} />
                )}
              </Button>
              <span className={cn('status-badge', statusClasses[item.status] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200')}>
                {item.status}
              </span>
            </div>
          </div>

          <div className="space-y-2 text-sm text-muted-foreground flex-1">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4" />
              <span className={cn('status-badge')} style={{ backgroundColor: categoryColor, color: '#fff' }}>
                {item.category}
              </span>
              {item.quantity && item.quantity > 1 && (
                <span className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-1 rounded">
                  {item.quantity}x
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {totalQuantity} unit{reservedQuantity > 0 ? ` (${reservedQuantity} reserved, ${buyerCount} pembeli)` : ''} • {availableQuantity} tersedia
            </div>
            {isReservedItem && reservedQuantity > 0 && (
              <div
                className="flex items-center gap-2 text-xs text-muted-foreground"
                title={reservationTooltip || reservationSummary}
              >
                <span className={cn('status-badge status-reserved text-[10px] px-2 py-0.5')}>Reserved</span>
                <span>
                  {reservationSummary}{singleBuyerName ? ` untuk ${singleBuyerName}` : ''}
                </span>
              </div>
            )}
            
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-primary" />
              <span>
                Kos: <span className="font-medium text-foreground" data-testid={`cost-${item.id}`}>RM {costPriceDisplay}</span>
                {sellingPriceDisplay && (
                  <span className="ml-2">
                    | Jual: <span className={cn("font-medium", isLoss ? "text-red-500 dark:text-red-400" : "text-green-600 dark:text-green-400")} data-testid={`selling-${item.id}`}>RM {sellingPriceDisplay}</span>
                  </span>
                )}
              </span>
            </div>

            {item.status === 'terjual' && item.selling_price && (
              <div className="text-sm">
                {isLoss ? 'Rugi' : 'Untung'}: <span className={cn("font-medium", isLoss ? "text-red-500 dark:text-red-400" : "text-green-600 dark:text-green-400")}>
                  RM {profitDisplay}
                </span>
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end mt-4 pt-4 border-t border-border">
            <Button variant="destructive" size="icon" onClick={handleDelete}><Trash2 className="w-4 h-4" /></Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

const ItemList = ({
  items,
  onEdit,
  onDelete,
  onBulkDelete,
  onToggleFavorite,
  favoriteUpdatingIds = new Set(),
  categories = [],
  clients = []
}) => {
  const [selectedItems, setSelectedItems] = useState(new Set());

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

  const handleSelectItem = (itemId) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    setSelectedItems(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedItems.size === items.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(items.map(item => item.id)));
    }
  };

  const handleClearSelection = () => {
    setSelectedItems(new Set());
  };

  const handleBulkDelete = async () => {
    if (selectedItems.size === 0) return;

    const selectedCount = selectedItems.size;
    const confirmDelete = window.confirm(
      `Anda pasti mahu padam ${selectedCount} item? Tindakan ini tidak boleh diundur.`
    );

    if (confirmDelete && onBulkDelete) {
      await onBulkDelete(Array.from(selectedItems));
      setSelectedItems(new Set());
    }
  };

  return (
    <div className="space-y-4">
      {/* Bulk Actions Toolbar */}
      {selectedItems.size > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between p-4 bg-primary/10 border border-primary rounded-lg"
        >
          <div className="flex items-center gap-4">
            <Checkbox
              checked={selectedItems.size === items.length}
              indeterminate={selectedItems.size > 0 && selectedItems.size < items.length}
              onClick={handleSelectAll}
              className="cursor-pointer"
            />
            <span className="text-sm font-medium">
              {selectedItems.size} daripada {items.length} item dipilih
            </span>
          </div>
          <div className="flex items-center gap-2 flex-col sm:flex-row w-full sm:w-auto">
            <Button
              variant="outline"
              size="default"
              onClick={handleClearSelection}
              className="gap-2 h-10 flex-1 sm:flex-initial"
            >
              <X className="w-5 h-5" />
              Batal
            </Button>
            <Button
              variant="destructive"
              size="default"
              onClick={handleBulkDelete}
              className="gap-2 h-10 flex-1 sm:flex-initial"
            >
              <Trash2 className="w-5 h-5" />
              Padam ({selectedItems.size})
            </Button>
          </div>
        </motion.div>
      )}

      {/* Items Grid */}
      <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        <AnimatePresence>
          {items.map((item, index) => (
            <ItemCard
              key={item.id}
              item={item}
              onEdit={onEdit}
              onDelete={onDelete}
              onToggleFavorite={onToggleFavorite}
              isFavoriteUpdating={favoriteUpdatingIds.has(item.id)}
              index={index}
              isSelected={selectedItems.has(item.id)}
              onSelectChange={handleSelectItem}
              categories={categories}
              clients={clients}
            />
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

export default ItemList;
