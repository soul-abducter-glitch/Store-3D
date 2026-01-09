# Store-3D UX Flow Overhaul Implementation Plan

## Overview
Transform the current side-drawer UX to a profile-centric model with quiet cart functionality and enhanced checkout experience.

## Implementation Steps

### Phase 1: Foundation & Header Navigation
- [ ] **1.1** Analyze current header/cart component structure
- [ ] **1.2** Implement new header navigation logic
- [ ] **1.3** Create toast notification system
- [ ] **1.4** Update cart badge functionality
- [ ] **1.5** Test header navigation for guest/logged-in users

### Phase 2: Quiet Cart Implementation  
- [ ] **2.1** Locate and modify add-to-cart handlers
- [ ] **2.2** Remove side-drawer auto-opening logic
- [ ] **2.3** Implement toast notifications for cart actions
- [ ] **2.4** Update cart badge on add-to-cart
- [ ] **2.5** Test quiet cart functionality

### Phase 3: Profile Dashboard Enhancement
- [ ] **3.1** Enhance Profile page cart section
- [ ] **3.2** Add cart item listing in Profile
- [ ] **3.3** Implement "Оформить заказ" button linking to /checkout
- [ ] **3.4** Improve cart management from Profile
- [ ] **3.5** Test profile cart functionality

### Phase 4: Checkout Page Redesign
- [ ] **4.1** Create new checkout layout with stepper
- [ ] **4.2** Implement delivery method visual cards (CDEK, YANDEX, OZON)
- [ ] **4.3** Add payment method radio buttons
- [ ] **4.4** Create sticky order summary sidebar
- [ ] **4.5** Ensure physical-only delivery step visibility
- [ ] **4.6** Apply Dark Lab aesthetic (obsidian bg, gold/cyan highlights)
- [ ] **4.7** Test complete checkout flow

### Phase 5: Digital Goods Integration
- [ ] **5.1** Enhance digital library functionality
- [ ] **5.2** Ensure immediate appearance in "Цифровая библиотека" tab
- [ ] **5.3** Configure S3 (Tebi) download links for rawModel files
- [ ] **5.4** Test digital goods fulfillment flow
- [ ] **5.5** Validate download functionality

### Phase 6: Data Consistency & Testing
- [ ] **6.1** Audit cart state ↔ Orders collection sync
- [ ] **6.2** Implement data consistency checks
- [ ] **6.3** Test end-to-end user flows
- [ ] **6.4** Cross-browser testing
- [ ] **6.5** Performance optimization
- [ ] **6.6** Final user acceptance testing

## Technical Considerations
- Maintain existing PayloadCMS collections structure
- Preserve Dark Lab aesthetic throughout
- Ensure responsive design
- Optimize for mobile experience
- Maintain existing authentication flow

## Files to be Modified
- Header/Cart components (to be identified)
- Add-to-cart handlers (to be located)
- Profile page enhancements
- Complete checkout page redesign
- Toast notification system
- Cart state management

## Success Criteria
✅ Quiet cart operation (no side-drawer)  
✅ Profile-centric navigation flow  
✅ Enhanced checkout experience  
✅ Seamless digital goods fulfillment  
✅ Data consistency maintained
