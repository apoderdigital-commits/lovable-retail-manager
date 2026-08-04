-- Comprovantes de entrega.
--
-- Bucket privado: a foto mostra a casa e às vezes o rosto do cliente,
-- então não pode ficar em URL pública adivinhável. A leitura sai por
-- URL assinada, com validade curta.
--
-- Cada entregador só escreve dentro da pasta com o próprio id, e só a
-- equipe (ou o dono do arquivo) consegue ler.

insert into storage.buckets (id, name, public)
values ('delivery-proofs', 'delivery-proofs', false)
on conflict (id) do nothing;

drop policy if exists "proof_insert_own_folder" on storage.objects;
create policy "proof_insert_own_folder" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'delivery-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "proof_read_staff_or_owner" on storage.objects;
create policy "proof_read_staff_or_owner" on storage.objects for select to authenticated
  using (
    bucket_id = 'delivery-proofs'
    and (is_staff() or (storage.foldername(name))[1] = auth.uid()::text)
  );
