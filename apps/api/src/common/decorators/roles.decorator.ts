import { SetMetadata } from '@nestjs/common';
import { Perfil } from '@ponto/shared';

export const PERFIS_KEY = 'perfis';
/** Restringe uma rota a perfis específicos. Ex.: @Perfis(Perfil.RH, Perfil.ADMIN_CLIENTE) */
export const Perfis = (...perfis: Perfil[]) => SetMetadata(PERFIS_KEY, perfis);
